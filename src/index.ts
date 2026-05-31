#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { registerSearchItems } from "./tools/searchItems.js";
import { registerPortalInfo } from "./tools/portalInfo.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  // Redacted config only — never log secrets.
  logger.info("Starting arcgis-mcp", { config: redactConfig(config) });

  const server = new McpServer({ name: "arcgis-mcp", version: "0.1.0" });

  // Tools register synchronously; no network access happens here, so the
  // server starts even if the portal is unreachable.
  registerSearchItems(server, config, logger);
  registerPortalInfo(server, config, logger);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`arcgis-mcp connected over ${config.transport} (auth mode: ${config.authMode})`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[error] Fatal error starting arcgis-mcp: ${message}\n`);
  process.exit(1);
});
