import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { createEnvAuthProvider, createTokenAuthProvider } from "./session.js";
import type { AuthProvider } from "./session.js";
import { buildServer } from "./server.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB guard against oversized payloads

/**
 * Per-request ArcGIS auth: the caller supplies their own token via
 * `X-ArcGIS-Token` or `Authorization: Bearer <token>`. No token ⇒ fall back to
 * the server's env credentials (which may be anonymous / public-only).
 */
function extractToken(req: IncomingMessage): string | undefined {
  const explicit = req.headers["x-arcgis-token"];
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && /^Bearer\s+/i.test(authorization)) {
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  return undefined;
}

function providerForRequest(req: IncomingMessage, config: Config, logger: Logger): AuthProvider {
  const token = extractToken(req);
  return token
    ? createTokenAuthProvider(config, logger, token)
    : createEnvAuthProvider(config, logger);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err: unknown) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-ArcGIS-Token, Mcp-Session-Id",
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  logger: Logger,
): Promise<void> {
  // Stateless: a fresh server + transport per request, bound to this caller's
  // identity. Avoids cross-request state leakage between different tokens.
  const auth = providerForRequest(req, config, logger);
  const server = buildServer(config, logger, auth);
  // Omitting `sessionIdGenerator` selects stateless mode (no session id / no
  // session validation) — the right fit for per-request, token-scoped auth.
  const transport = new StreamableHTTPServerTransport({});

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  // The SDK's transport classes are not authored under exactOptionalPropertyTypes,
  // so their `onclose`/`onerror` members are typed `(() => void) | undefined`
  // instead of optional. Cast at this single boundary; runtime contract is identical.
  await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
  const body = req.method === "POST" ? await readBody(req) : undefined;
  await transport.handleRequest(req, res, body);
}

/** Start the Streamable HTTP transport on the configured host/port. */
export function startHttpServer(config: Config, logger: Logger): Promise<void> {
  const httpServer = createServer((req, res) => {
    setCors(res);

    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (path === HEALTH_PATH) {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: `Not found. MCP endpoint is ${MCP_PATH}` });
      return;
    }

    handleMcp(req, res, config, logger).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("HTTP request handling failed", { error: message });
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal server error: ${message}` },
          id: null,
        });
      } else {
        res.end();
      }
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(config.httpPort, config.httpHost, () => {
      logger.info(
        `arcgis-mcp listening on http://${config.httpHost}:${config.httpPort}${MCP_PATH} ` +
          `(health: ${HEALTH_PATH})`,
      );
      resolve();
    });
  });
}
