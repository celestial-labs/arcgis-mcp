import {
  ApiKeyManager,
  ApplicationCredentialsManager,
  ArcGISIdentityManager,
} from "@esri/arcgis-rest-request";
import type { IAuthenticationManager, IRequestOptions } from "@esri/arcgis-rest-request";
import { getSelf } from "@esri/arcgis-rest-portal";
import type { IPortal } from "@esri/arcgis-rest-portal";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * Lazy, memoized authentication + portal-self access.
 *
 * Nothing here runs at import time — the first tool call triggers auth. That
 * keeps the server startable even when the portal is unreachable or the
 * credentials are wrong; such failures surface as structured tool errors.
 */

let authPromise: Promise<IAuthenticationManager | undefined> | undefined;
let selfPromise: Promise<IPortal> | undefined;

/** Reset cached state. Intended for tests. */
export function resetSession(): void {
  authPromise = undefined;
  selfPromise = undefined;
}

async function buildAuthentication(
  config: Config,
  logger: Logger,
): Promise<IAuthenticationManager | undefined> {
  logger.debug("Initializing ArcGIS authentication", { authMode: config.authMode });

  switch (config.authMode) {
    case "apiKey":
      return ApiKeyManager.fromKey({ key: config.apiKey!, portal: config.sharingRestUrl });
    case "appLogin":
      return ApplicationCredentialsManager.fromCredentials({
        clientId: config.clientId!,
        clientSecret: config.clientSecret!,
        portal: config.sharingRestUrl,
      });
    case "userPassword":
      return ArcGISIdentityManager.signIn({
        username: config.username!,
        password: config.password!,
        portal: config.sharingRestUrl,
      });
    case "anonymous":
      return undefined;
  }
}

/**
 * Get the authentication manager for the configured mode (or `undefined` for
 * anonymous). Memoized; on failure the cache is cleared so the next call retries.
 */
export function getAuthentication(
  config: Config,
  logger: Logger,
): Promise<IAuthenticationManager | undefined> {
  if (!authPromise) {
    authPromise = buildAuthentication(config, logger).catch((err: unknown) => {
      authPromise = undefined;
      throw err;
    });
  }
  return authPromise;
}

/**
 * Fetch (and cache) `/sharing/rest/portals/self`. Triggers authentication.
 * For anonymous access this returns the public portal description (no `user`).
 */
export function getPortalSelf(config: Config, logger: Logger): Promise<IPortal> {
  if (!selfPromise) {
    selfPromise = (async () => {
      const authentication = await getAuthentication(config, logger);
      const options: IRequestOptions = { portal: config.sharingRestUrl };
      if (authentication) options.authentication = authentication;
      logger.debug("Fetching portal self", { portal: config.sharingRestUrl });
      return getSelf(options);
    })().catch((err: unknown) => {
      selfPromise = undefined;
      throw err;
    });
  }
  return selfPromise;
}
