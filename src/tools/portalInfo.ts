import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { getPortalSelf } from "../session.js";

/** Minimal shape of the `user` object on the portal-self response. */
interface PortalSelfUser {
  username?: string;
  fullName?: string;
  role?: string;
}

async function buildPortalInfo(config: Config, logger: Logger) {
  const base = { portalUrl: config.portalUrl, authMode: config.authMode };

  if (config.authMode === "anonymous") {
    return { ...base, authenticated: false };
  }

  try {
    const self = await getPortalSelf(config, logger);
    // `IPortal` has an index signature; `user` is present for user-based auth
    // and absent for app login.
    const user = self.user as PortalSelfUser | undefined;

    return {
      ...base,
      authenticated: true,
      username: user?.username ?? null,
      fullName: user?.fullName ?? null,
      role: user?.role ?? null,
      orgId: self.id ?? null,
      orgName: self.name ?? null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("portal_info auth check failed", { error: message });
    return { ...base, authenticated: false, error: message };
  }
}

export function registerPortalInfo(server: McpServer, config: Config, logger: Logger): void {
  server.registerTool(
    "portal_info",
    {
      title: "Portal info / connection check",
      description:
        "Diagnostic tool. Takes no arguments. Triggers authentication and reports the " +
        "portal URL, auth mode, and (when authenticated) the signed-in user and org. " +
        'Use it as the "am I connected correctly?" check.',
      inputSchema: {},
    },
    async () => {
      const payload = await buildPortalInfo(config, logger);
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
