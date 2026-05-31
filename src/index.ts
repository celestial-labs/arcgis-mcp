#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createEnvAuthProvider } from "./session.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  // Redacted config only — never log secrets.
  logger.info("Starting arcgis-mcp", { config: redactConfig(config) });

  if (config.transport === "http") {
    // Per-request auth: each HTTP request builds its own provider, so the
    // server (and its env credentials) is created lazily inside the handler.
    await startHttpServer(config, logger);
    return;
  }

  // stdio: a single server bound to the env-configured identity.
  const auth = createEnvAuthProvider(config, logger);
  const server = buildServer(config, logger, auth);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`arcgis-mcp connected over stdio (auth mode: ${config.authMode})`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[error] Fatal error starting arcgis-mcp: ${message}\n`);
  process.exit(1);
});
