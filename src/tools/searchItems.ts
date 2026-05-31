import { z } from "zod";
import { searchItems } from "@esri/arcgis-rest-portal";
import type { IItem, ISearchOptions } from "@esri/arcgis-rest-portal";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { AuthProvider } from "../session.js";
import { toIso, truncate } from "../util/format.js";

const MAX_DESCRIPTION = 500;

/** Subset of the tool input used to assemble the Esri search query string. */
export interface SearchQueryParts {
  query?: string | undefined;
  itemType?: string | undefined;
  owner?: string | undefined;
  tags?: readonly string[] | undefined;
}

/**
 * Build an ArcGIS search-syntax query string from the structured parts.
 * Pure and exported so the combinations can be unit-tested without the network.
 *
 * Clauses are AND-combined in a stable order: free text, type, owner, tags.
 */
export function buildQuery(parts: SearchQueryParts): string {
  const clauses: string[] = [];

  const query = parts.query?.trim();
  if (query) clauses.push(query);

  const itemType = parts.itemType?.trim();
  if (itemType) clauses.push(`type:"${itemType}"`);

  const owner = parts.owner?.trim();
  if (owner) clauses.push(`owner:${owner}`);

  if (parts.tags) {
    for (const tag of parts.tags) {
      const trimmed = tag.trim();
      if (trimmed) clauses.push(`tags:"${trimmed}"`);
    }
  }

  return clauses.join(" AND ");
}

// Raw Zod shape — registerTool (SDK 1.x) derives the validated, typed input
// from this shape directly. Do NOT wrap in z.object().
const inputSchema = {
  query: z.string().default("").describe("Free-text search terms. Esri search syntax is allowed."),
  itemType: z
    .string()
    .optional()
    .describe('Item type filter, e.g. "Web Map", "Feature Layer", "Dashboard".'),
  owner: z.string().optional().describe("Restrict to a single owner (username)."),
  tags: z.array(z.string()).optional().describe("Tags, AND-combined and quoted."),
  maxItems: z.number().int().min(1).max(100).default(10).describe("Max items to return (1-100)."),
  sortField: z
    .string()
    .optional()
    .describe('Sort field, e.g. "title", "modified", "created", "numviews".'),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  outsideOrg: z
    .boolean()
    .default(false)
    .describe("If true, search public items beyond your organization (query must be non-empty)."),
};

type SearchInput = {
  query: string;
  itemType?: string | undefined;
  owner?: string | undefined;
  tags?: string[] | undefined;
  maxItems: number;
  sortField?: string | undefined;
  sortOrder: "asc" | "desc";
  outsideOrg: boolean;
};

function mapItem(item: IItem, config: Config) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    owner: item.owner ?? null,
    snippet: item.snippet ?? null,
    description: truncate(item.description, MAX_DESCRIPTION),
    tags: item.tags ?? [],
    modified: toIso(item.modified),
    created: toIso(item.created),
    numViews: item.numViews ?? null,
    access: item.access ?? null,
    serviceUrl: item.url ?? null,
    itemPage: `${config.portalUrl}/home/item.html?id=${item.id}`,
  };
}

async function runSearch(input: SearchInput, config: Config, logger: Logger, auth: AuthProvider) {
  const baseQuery = buildQuery({
    query: input.query,
    itemType: input.itemType,
    owner: input.owner,
    tags: input.tags,
  });

  if (input.outsideOrg && baseQuery === "") {
    throw new Error("A non-empty query is required when outsideOrg=true.");
  }

  // Resolve auth first: bad credentials/token surface here as a thrown error,
  // which the handler turns into a structured tool error.
  const authentication = await auth.getAuthentication();

  let finalQuery = baseQuery;

  // Scope to the caller's org unless explicitly asked to search the whole
  // portal. Only meaningful when authenticated (anonymous has no org).
  if (!input.outsideOrg && authentication) {
    try {
      const self = await auth.getPortalSelf();
      if (self.id) {
        finalQuery = baseQuery ? `${baseQuery} AND orgid:${self.id}` : `orgid:${self.id}`;
      }
    } catch (err: unknown) {
      logger.debug("Could not resolve org for scoping; searching unscoped", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const options: ISearchOptions = {
    q: finalQuery,
    num: input.maxItems,
    sortOrder: input.sortOrder,
    portal: config.sharingRestUrl,
  };
  if (input.sortField) options.sortField = input.sortField;
  if (authentication) options.authentication = authentication;

  logger.debug("Searching items", { q: finalQuery, num: input.maxItems });
  const result = await searchItems(options);

  const items = result.results.map((item) => mapItem(item, config));
  return {
    query: finalQuery,
    itemTypeFilter: input.itemType ?? null,
    count: items.length,
    maxItems: input.maxItems,
    outsideOrg: input.outsideOrg,
    items,
  };
}

export function registerSearchItems(
  server: McpServer,
  config: Config,
  logger: Logger,
  auth: AuthProvider,
): void {
  server.registerTool(
    "search_items",
    {
      title: "Search ArcGIS items",
      description:
        "Search an ArcGIS Portal / ArcGIS Online for items (Web Maps, Feature Layers, " +
        "Apps, Dashboards, …). Combines query, owner and tags with AND. Returns item " +
        "metadata plus a clickable item page URL.",
      inputSchema,
    },
    async (input) => {
      try {
        const payload = await runSearch(input as SearchInput, config, logger, auth);
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("search_items failed", { error: message });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
