import { z } from "zod";
import { getItem, getItemData } from "@esri/arcgis-rest-portal";
import type { IRequestOptions } from "@esri/arcgis-rest-request";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { AuthProvider } from "../session.js";
import { toIso, truncate } from "../util/format.js";

const MAX_DESCRIPTION = 500;
// Item data can be huge (or binary). Cap what we inline; bigger payloads are
// left to be downloaded directly from `dataUrl`.
const MAX_INLINE_DATA_BYTES = 100_000;

const inputSchema = {
  id: z.string().min(1).describe("The ArcGIS item id (e.g. from search_items results)."),
  includeData: z
    .boolean()
    .default(true)
    .describe(
      "Fetch the item's content/data (e.g. the form or web map JSON) and inline it " +
        "when it is JSON and small enough.",
    ),
};

type GetItemInput = { id: string; includeData: boolean };

async function runGetItem(input: GetItemInput, config: Config, logger: Logger, auth: AuthProvider) {
  const authentication = await auth.getAuthentication();
  const sharingRestUrl = auth.getSharingRestUrl();
  const requestOptions: IRequestOptions = { portal: sharingRestUrl };
  if (authentication) requestOptions.authentication = authentication;

  const item = await getItem(input.id, requestOptions);

  // Direct REST download endpoint for the raw content (needs a token for
  // non-public items — pass it the same way you authenticate this server).
  const dataUrl = `${sharingRestUrl}/content/items/${item.id}/data`;

  const result: {
    id: string;
    title: string;
    type: string;
    owner: string | null;
    snippet: string | null;
    description: string | null;
    tags: string[];
    access: string | null;
    created: string | null;
    modified: string | null;
    serviceUrl: string | null;
    itemPage: string;
    dataUrl: string;
    dataIncluded: boolean;
    data?: unknown;
    dataNote?: string;
  } = {
    id: item.id,
    title: item.title,
    type: item.type,
    owner: item.owner ?? null,
    snippet: item.snippet ?? null,
    description: truncate(item.description, MAX_DESCRIPTION),
    tags: item.tags ?? [],
    access: item.access ?? null,
    created: toIso(item.created),
    modified: toIso(item.modified),
    serviceUrl: item.url ?? null,
    itemPage: `${sharingRestUrl.replace(/\/sharing\/rest$/, "")}/home/item.html?id=${item.id}`,
    dataUrl,
    dataIncluded: false,
  };

  if (!input.includeData) {
    result.dataNote = "Data not requested (includeData=false). Download it from dataUrl if needed.";
    return result;
  }

  try {
    logger.debug("Fetching item data", { id: input.id });
    const data: unknown = await getItemData(input.id, requestOptions);

    if (data === undefined || data === null || data === "") {
      result.dataNote = "This item has no data payload.";
    } else if (typeof data === "object" || typeof data === "string") {
      const serialized = typeof data === "string" ? data : JSON.stringify(data);
      if (Buffer.byteLength(serialized, "utf8") > MAX_INLINE_DATA_BYTES) {
        result.dataNote = `Data omitted (> ${MAX_INLINE_DATA_BYTES} bytes). Download it from dataUrl.`;
      } else {
        result.data = data;
        result.dataIncluded = true;
      }
    } else {
      result.dataNote = "Binary or non-JSON data. Download it from dataUrl.";
    }
  } catch (err: unknown) {
    result.dataNote = `Could not fetch data: ${err instanceof Error ? err.message : String(err)}`;
  }

  return result;
}

export function registerGetItem(
  server: McpServer,
  config: Config,
  logger: Logger,
  auth: AuthProvider,
): void {
  server.registerTool(
    "get_item",
    {
      title: "Get an ArcGIS item (with content)",
      description:
        "Fetch a single ArcGIS item by id: full metadata plus its content/data " +
        "(e.g. a form definition or web map JSON) inlined when it is JSON and small " +
        "enough, otherwise a dataUrl to download it directly.",
      inputSchema,
    },
    async (input) => {
      try {
        const payload = await runGetItem(input as GetItemInput, config, logger, auth);
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("get_item failed", { error: message });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
