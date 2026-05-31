import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { AuthProvider } from "./session.js";
import { registerSearchItems } from "./tools/searchItems.js";
import { registerGetItem } from "./tools/getItem.js";
import { registerGetItemResources } from "./tools/getItemResources.js";
import { registerPortalInfo } from "./tools/portalInfo.js";

export const SERVER_NAME = "arcgis-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * Build a fully-wired McpServer for a given auth provider.
 *
 * Tool registration is synchronous and does no network I/O, so this is cheap
 * enough to call once per HTTP request (each request gets its own server bound
 * to its own caller identity).
 */
export function buildServer(config: Config, logger: Logger, auth: AuthProvider): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerSearchItems(server, config, logger, auth);
  registerGetItem(server, config, logger, auth);
  registerGetItemResources(server, config, logger, auth);
  registerPortalInfo(server, config, logger, auth);
  return server;
}
