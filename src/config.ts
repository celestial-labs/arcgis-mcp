import type { LogLevel } from "./logger.js";

/**
 * Supported authentication modes, in order of precedence (first match wins).
 *
 * 1. `apiKey`        — ARCGIS_API_KEY
 * 2. `appLogin`      — ARCGIS_CLIENT_ID + ARCGIS_CLIENT_SECRET (OAuth 2.0 app login)
 * 3. `userPassword`  — ARCGIS_USERNAME + ARCGIS_PASSWORD
 * 4. `anonymous`     — none of the above
 */
export type AuthMode = "apiKey" | "appLogin" | "userPassword" | "anonymous";

export interface Config {
  /** Base portal URL, e.g. `https://www.arcgis.com` (no trailing slash). */
  readonly portalUrl: string;
  /** Sharing REST endpoint, e.g. `https://www.arcgis.com/sharing/rest`. */
  readonly sharingRestUrl: string;
  readonly authMode: AuthMode;
  readonly apiKey?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly username?: string;
  readonly password?: string;
  readonly logLevel: LogLevel;
  readonly transport: "stdio";
}

const DEFAULT_PORTAL_URL = "https://www.arcgis.com";
const REDACTED = "***redacted***";

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseLogLevel(value: string | undefined): LogLevel {
  switch (clean(value)) {
    case "debug":
      return "debug";
    case "error":
      return "error";
    case "info":
    case undefined:
      return "info";
    default:
      // Unknown values fall back to the default rather than crashing.
      return "info";
  }
}

/**
 * Determine the auth mode purely from which credentials are present.
 * Exported so the precedence rules can be unit-tested without building a Config.
 */
export function detectAuthMode(env: Env): AuthMode {
  if (clean(env.ARCGIS_API_KEY)) return "apiKey";
  if (clean(env.ARCGIS_CLIENT_ID) && clean(env.ARCGIS_CLIENT_SECRET)) return "appLogin";
  if (clean(env.ARCGIS_USERNAME) && clean(env.ARCGIS_PASSWORD)) return "userPassword";
  return "anonymous";
}

function normalizePortalUrl(value: string | undefined): string {
  const base = clean(value) ?? DEFAULT_PORTAL_URL;
  return base.replace(/\/+$/, "");
}

/**
 * Build the immutable runtime Config from environment variables.
 * Pure function (takes `env` explicitly) so it is trivially testable.
 */
export function loadConfig(env: Env = process.env): Config {
  const portalUrl = normalizePortalUrl(env.ARCGIS_PORTAL_URL);
  const authMode = detectAuthMode(env);

  // Build conditionally to satisfy exactOptionalPropertyTypes (no `key: undefined`).
  const base = {
    portalUrl,
    sharingRestUrl: `${portalUrl}/sharing/rest`,
    authMode,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    transport: "stdio",
  } as const;

  switch (authMode) {
    case "apiKey":
      return { ...base, apiKey: clean(env.ARCGIS_API_KEY)! };
    case "appLogin":
      return {
        ...base,
        clientId: clean(env.ARCGIS_CLIENT_ID)!,
        clientSecret: clean(env.ARCGIS_CLIENT_SECRET)!,
      };
    case "userPassword":
      return {
        ...base,
        username: clean(env.ARCGIS_USERNAME)!,
        password: clean(env.ARCGIS_PASSWORD)!,
      };
    case "anonymous":
      return { ...base };
  }
}

/** Config with all secrets redacted — safe to log. */
export function redactConfig(config: Config): Record<string, unknown> {
  return {
    portalUrl: config.portalUrl,
    sharingRestUrl: config.sharingRestUrl,
    authMode: config.authMode,
    logLevel: config.logLevel,
    transport: config.transport,
    apiKey: config.apiKey ? REDACTED : undefined,
    clientId: config.clientId ? REDACTED : undefined,
    clientSecret: config.clientSecret ? REDACTED : undefined,
    username: config.username ?? undefined,
    password: config.password ? REDACTED : undefined,
  };
}
