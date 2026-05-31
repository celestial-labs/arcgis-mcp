import { describe, expect, it } from "vitest";
import { detectAuthMode, isPortalAllowed, loadConfig, redactConfig } from "../src/config.js";

describe("detectAuthMode", () => {
  it("detects apiKey mode", () => {
    expect(detectAuthMode({ ARCGIS_API_KEY: "AAPKxyz" })).toBe("apiKey");
  });

  it("detects appLogin mode", () => {
    expect(detectAuthMode({ ARCGIS_CLIENT_ID: "id123", ARCGIS_CLIENT_SECRET: "secret" })).toBe(
      "appLogin",
    );
  });

  it("detects userPassword mode", () => {
    expect(detectAuthMode({ ARCGIS_USERNAME: "jane", ARCGIS_PASSWORD: "pw" })).toBe("userPassword");
  });

  it("detects anonymous mode when nothing is set", () => {
    expect(detectAuthMode({})).toBe("anonymous");
  });

  it("ignores blank/whitespace-only values", () => {
    expect(detectAuthMode({ ARCGIS_API_KEY: "   " })).toBe("anonymous");
    expect(detectAuthMode({ ARCGIS_CLIENT_ID: "id", ARCGIS_CLIENT_SECRET: "  " })).toBe(
      "anonymous",
    );
  });

  describe("precedence (first match wins)", () => {
    it("apiKey beats everything", () => {
      expect(
        detectAuthMode({
          ARCGIS_API_KEY: "k",
          ARCGIS_CLIENT_ID: "id",
          ARCGIS_CLIENT_SECRET: "s",
          ARCGIS_USERNAME: "jane",
          ARCGIS_PASSWORD: "pw",
        }),
      ).toBe("apiKey");
    });

    it("appLogin beats userPassword", () => {
      expect(
        detectAuthMode({
          ARCGIS_CLIENT_ID: "id",
          ARCGIS_CLIENT_SECRET: "s",
          ARCGIS_USERNAME: "jane",
          ARCGIS_PASSWORD: "pw",
        }),
      ).toBe("appLogin");
    });

    it("incomplete appLogin falls through to userPassword", () => {
      expect(
        detectAuthMode({
          ARCGIS_CLIENT_ID: "id", // no secret
          ARCGIS_USERNAME: "jane",
          ARCGIS_PASSWORD: "pw",
        }),
      ).toBe("userPassword");
    });
  });
});

describe("loadConfig", () => {
  it("defaults to ArcGIS Online and stdio/info", () => {
    const cfg = loadConfig({});
    expect(cfg.portalUrl).toBe("https://www.arcgis.com");
    expect(cfg.sharingRestUrl).toBe("https://www.arcgis.com/sharing/rest");
    expect(cfg.authMode).toBe("anonymous");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.transport).toBe("stdio");
  });

  it("strips a trailing slash from the portal URL", () => {
    const cfg = loadConfig({ ARCGIS_PORTAL_URL: "https://org.example.com/portal/" });
    expect(cfg.portalUrl).toBe("https://org.example.com/portal");
    expect(cfg.sharingRestUrl).toBe("https://org.example.com/portal/sharing/rest");
  });

  it("populates apiKey for apiKey mode and nothing else", () => {
    const cfg = loadConfig({ ARCGIS_API_KEY: "AAPKxyz" });
    expect(cfg.authMode).toBe("apiKey");
    expect(cfg.apiKey).toBe("AAPKxyz");
    expect(cfg.clientId).toBeUndefined();
    expect(cfg.username).toBeUndefined();
  });

  it("populates credentials for appLogin and userPassword modes", () => {
    const app = loadConfig({ ARCGIS_CLIENT_ID: "id", ARCGIS_CLIENT_SECRET: "secret" });
    expect(app.clientId).toBe("id");
    expect(app.clientSecret).toBe("secret");

    const user = loadConfig({ ARCGIS_USERNAME: "jane", ARCGIS_PASSWORD: "pw" });
    expect(user.username).toBe("jane");
    expect(user.password).toBe("pw");
  });

  it("parses LOG_LEVEL and falls back to info on unknown values", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(loadConfig({ LOG_LEVEL: "error" }).logLevel).toBe("error");
    expect(loadConfig({ LOG_LEVEL: "verbose" }).logLevel).toBe("info");
  });

  it("defaults the transport to stdio", () => {
    expect(loadConfig({}).transport).toBe("stdio");
  });

  it("selects the http transport via MCP_TRANSPORT (case-insensitive)", () => {
    expect(loadConfig({ MCP_TRANSPORT: "http" }).transport).toBe("http");
    expect(loadConfig({ MCP_TRANSPORT: "HTTP" }).transport).toBe("http");
    expect(loadConfig({ MCP_TRANSPORT: "sse" }).transport).toBe("stdio");
  });

  it("honors PORT then MCP_HTTP_PORT, falling back to 3000", () => {
    expect(loadConfig({}).httpPort).toBe(3000);
    expect(loadConfig({ MCP_HTTP_PORT: "8080" }).httpPort).toBe(8080);
    expect(loadConfig({ PORT: "9000", MCP_HTTP_PORT: "8080" }).httpPort).toBe(9000);
    expect(loadConfig({ PORT: "not-a-port" }).httpPort).toBe(3000);
  });
});

describe("redactConfig", () => {
  it("redacts every secret but keeps the username and portal", () => {
    const cfg = loadConfig({
      ARCGIS_API_KEY: "AAPK-super-secret",
    });
    const safe = redactConfig(cfg);
    expect(JSON.stringify(safe)).not.toContain("AAPK-super-secret");
    expect(safe.apiKey).toBe("***redacted***");
  });

  it("redacts password but exposes username (not a secret)", () => {
    const cfg = loadConfig({ ARCGIS_USERNAME: "jane", ARCGIS_PASSWORD: "hunter2" });
    const safe = redactConfig(cfg);
    expect(safe.username).toBe("jane");
    expect(safe.password).toBe("***redacted***");
    expect(JSON.stringify(safe)).not.toContain("hunter2");
  });

  it("redacts client secret", () => {
    const cfg = loadConfig({ ARCGIS_CLIENT_ID: "id", ARCGIS_CLIENT_SECRET: "topsecret" });
    const safe = redactConfig(cfg);
    expect(safe.clientId).toBe("***redacted***");
    expect(safe.clientSecret).toBe("***redacted***");
    expect(JSON.stringify(safe)).not.toContain("topsecret");
  });
});

describe("isPortalAllowed (SSRF protection)", () => {
  it("allows the default portal when no allowlist is set", () => {
    const cfg = loadConfig({});
    expect(cfg.allowedPortals).toEqual(["www.arcgis.com"]);
    expect(isPortalAllowed("https://www.arcgis.com", cfg)).toBe(true);
  });

  it("allows only the default portal when ARCGIS_ALLOWED_PORTALS is unset", () => {
    const cfg = loadConfig({ ARCGIS_PORTAL_URL: "https://gis.example.com/portal" });
    expect(cfg.allowedPortals).toEqual(["gis.example.com"]);
    expect(isPortalAllowed("https://gis.example.com/portal", cfg)).toBe(true);
    expect(isPortalAllowed("https://www.arcgis.com", cfg)).toBe(false);
  });

  it("parses comma-separated allowlist from ARCGIS_ALLOWED_PORTALS", () => {
    const cfg = loadConfig({
      ARCGIS_ALLOWED_PORTALS: "www.arcgis.com, gis.example.com , other.org",
    });
    expect(cfg.allowedPortals).toEqual(["www.arcgis.com", "gis.example.com", "other.org"]);
    expect(isPortalAllowed("https://www.arcgis.com", cfg)).toBe(true);
    expect(isPortalAllowed("https://gis.example.com/portal", cfg)).toBe(true);
    expect(isPortalAllowed("https://other.org/gis", cfg)).toBe(true);
    expect(isPortalAllowed("https://malicious.com", cfg)).toBe(false);
  });

  it("deduplicates and trims the allowlist", () => {
    const cfg = loadConfig({
      ARCGIS_ALLOWED_PORTALS: "host.com , host.com, other.com ",
    });
    expect(cfg.allowedPortals).toEqual(["host.com", "other.com"]);
  });

  it("ignores blank entries", () => {
    const cfg = loadConfig({
      ARCGIS_ALLOWED_PORTALS: "host.com,  , other.com",
    });
    expect(cfg.allowedPortals).toEqual(["host.com", "other.com"]);
  });

  it("extracts hostname from full URLs for comparison", () => {
    const cfg = loadConfig({ ARCGIS_ALLOWED_PORTALS: "gis.example.com" });
    // URLs with different schemes, ports, paths should still match by hostname.
    expect(isPortalAllowed("https://gis.example.com", cfg)).toBe(true);
    expect(isPortalAllowed("http://gis.example.com:7080/portal", cfg)).toBe(true);
    expect(isPortalAllowed("https://gis.example.com/portal/sharing/rest", cfg)).toBe(true);
    // But different hostname should not match.
    expect(isPortalAllowed("https://other.example.com", cfg)).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    const cfg = loadConfig({ ARCGIS_ALLOWED_PORTALS: "valid.com" });
    expect(isPortalAllowed("not-a-url", cfg)).toBe(false);
    expect(isPortalAllowed("", cfg)).toBe(false);
  });
});
