import {
  ApiKeyManager,
  ApplicationCredentialsManager,
  ArcGISIdentityManager,
} from "@esri/arcgis-rest-request";
import type { IAuthenticationManager, IRequestOptions } from "@esri/arcgis-rest-request";
import { getSelf } from "@esri/arcgis-rest-portal";
import type { IPortal } from "@esri/arcgis-rest-portal";
import type { AuthMode, Config } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * Per-instance authentication + portal-self access.
 *
 * A provider is an isolated unit of auth state. For stdio there is exactly one
 * provider (built from env vars). For the HTTP transport a fresh provider is
 * created per request, so each caller's ArcGIS identity stays isolated.
 *
 * Nothing here runs eagerly — the first call builds the session lazily, so the
 * server stays startable even when the portal is unreachable or credentials are
 * wrong; such failures surface as structured tool errors.
 */
export interface AuthProvider {
  /** Label describing how this provider authenticates. */
  readonly mode: AuthMode | "token";
  /** The ArcGIS auth manager, or `undefined` for anonymous access. */
  getAuthentication(): Promise<IAuthenticationManager | undefined>;
  /** Cached `/portals/self` for this provider. Triggers authentication. */
  getPortalSelf(): Promise<IPortal>;
}

type BuildAuth = () => Promise<IAuthenticationManager | undefined>;

/**
 * Wrap an auth-building function with lazy, per-instance memoization plus a
 * shared `getPortalSelf` implementation. On failure the cache is cleared so the
 * next call retries.
 */
function makeProvider(
  mode: AuthMode | "token",
  config: Config,
  buildAuth: BuildAuth,
): AuthProvider {
  let authPromise: Promise<IAuthenticationManager | undefined> | undefined;
  let selfPromise: Promise<IPortal> | undefined;

  const getAuthentication = (): Promise<IAuthenticationManager | undefined> => {
    if (!authPromise) {
      authPromise = buildAuth().catch((err: unknown) => {
        authPromise = undefined;
        throw err;
      });
    }
    return authPromise;
  };

  const getPortalSelf = (): Promise<IPortal> => {
    if (!selfPromise) {
      selfPromise = (async () => {
        const authentication = await getAuthentication();
        const options: IRequestOptions = { portal: config.sharingRestUrl };
        if (authentication) options.authentication = authentication;
        return getSelf(options);
      })().catch((err: unknown) => {
        selfPromise = undefined;
        throw err;
      });
    }
    return selfPromise;
  };

  return { mode, getAuthentication, getPortalSelf };
}

/** Build the auth manager from environment-configured credentials. */
function buildEnvAuthentication(
  config: Config,
  logger: Logger,
): Promise<IAuthenticationManager | undefined> {
  logger.debug("Initializing ArcGIS authentication", { authMode: config.authMode });

  switch (config.authMode) {
    case "apiKey":
      return Promise.resolve(
        ApiKeyManager.fromKey({ key: config.apiKey!, portal: config.sharingRestUrl }),
      );
    case "appLogin":
      return Promise.resolve(
        ApplicationCredentialsManager.fromCredentials({
          clientId: config.clientId!,
          clientSecret: config.clientSecret!,
          portal: config.sharingRestUrl,
        }),
      );
    case "userPassword":
      return ArcGISIdentityManager.signIn({
        username: config.username!,
        password: config.password!,
        portal: config.sharingRestUrl,
      });
    case "anonymous":
      return Promise.resolve(undefined);
  }
}

/**
 * Provider backed by environment-variable credentials (stdio transport, and the
 * fallback for HTTP requests that arrive without a token).
 */
export function createEnvAuthProvider(config: Config, logger: Logger): AuthProvider {
  return makeProvider(config.authMode, config, () => buildEnvAuthentication(config, logger));
}

/**
 * Provider backed by a caller-supplied ArcGIS token (per-request HTTP auth).
 * The token is exchanged for an `ArcGISIdentityManager` bound to the portal.
 */
export function createTokenAuthProvider(
  config: Config,
  logger: Logger,
  token: string,
): AuthProvider {
  return makeProvider("token", config, () => {
    logger.debug("Building per-request token authentication");
    return ArcGISIdentityManager.fromToken({ token, portal: config.sharingRestUrl });
  });
}
