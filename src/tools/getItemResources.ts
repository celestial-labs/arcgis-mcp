import { z } from "zod";
import { getItemResources, getItemResource } from "@esri/arcgis-rest-portal";
import type { IRequestOptions } from "@esri/arcgis-rest-request";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { AuthProvider } from "../session.js";
import { toIso } from "../util/format.js";

const MAX_INLINE_RESOURCE_BYTES = 100_000;

const inputSchema = {
  id: z.string().min(1).describe("The ArcGIS item id."),
  fileName: z
    .string()
    .optional()
    .describe(
      "If provided, fetch the content of this specific resource file (e.g. \"thumbnail/ago_downloaded.png\"). " +
        "When omitted, lists all resources for the item.",
    ),
};

type GetItemResourcesInput = { id: string; fileName?: string | undefined };

async function runGetItemResources(
  input: GetItemResourcesInput,
  config: Config,
  logger: Logger,
  auth: AuthProvider,
) {
  const authentication = await auth.getAuthentication();
  const requestOptions: IRequestOptions = { portal: config.sharingRestUrl };
  if (authentication) requestOptions.authentication = authentication;

  // Fetch a single resource's content when fileName is provided.
  if (input.fileName) {
    logger.debug("Fetching item resource content", { id: input.id, fileName: input.fileName });
    const data: unknown = await getItemResource(input.id, {
      ...requestOptions,
      fileName: input.fileName,
      readAs: "json",
    });

    const resourceUrl =
      `${config.sharingRestUrl}/content/items/${input.id}/resources/${input.fileName}`;

    if (data === undefined || data === null) {
      return {
        id: input.id,
        fileName: input.fileName,
        resourceUrl,
        dataIncluded: false,
        dataNote: "Resource returned no content.",
      };
    }

    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    if (Buffer.byteLength(serialized, "utf8") > MAX_INLINE_RESOURCE_BYTES) {
      return {
        id: input.id,
        fileName: input.fileName,
        resourceUrl,
        dataIncluded: false,
        dataNote: `Content omitted (> ${MAX_INLINE_RESOURCE_BYTES} bytes). Download from resourceUrl.`,
      };
    }

    return {
      id: input.id,
      fileName: input.fileName,
      resourceUrl,
      dataIncluded: true,
      data,
    };
  }

  // List all resources.
  logger.debug("Listing item resources", { id: input.id });
  const response = await getItemResources(input.id, requestOptions);

  const resources = (response.resources ?? []).map((r) => ({
    fileName: r.resource,
    access: r.access,
    size: r.size,
    created: toIso(r.created),
    resourceUrl: `${config.sharingRestUrl}/content/items/${input.id}/resources/${r.resource}`,
  }));

  return {
    id: input.id,
    total: response.total,
    count: resources.length,
    resources,
  };
}

export function registerGetItemResources(
  server: McpServer,
  config: Config,
  logger: Logger,
  auth: AuthProvider,
): void {
  server.registerTool(
    "get_item_resources",
    {
      title: "List or fetch ArcGIS item resources",
      description:
        "List all file resources attached to an ArcGIS item, or fetch the content of a " +
        "specific resource by fileName. Each resource entry includes its download URL. " +
        "JSON resources small enough to inline are returned directly under `data`.",
      inputSchema,
    },
    async (input) => {
      try {
        const payload = await runGetItemResources(
          input as GetItemResourcesInput,
          config,
          logger,
          auth,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("get_item_resources failed", { error: message });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
