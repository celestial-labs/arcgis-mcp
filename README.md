# arcgis-mcp

A lean [Model Context Protocol](https://modelcontextprotocol.io) server that lets
MCP clients (Claude Desktop, etc.) search and inspect **ArcGIS Portal** and
**ArcGIS Online** content. It talks to the ArcGIS REST API directly via
[`@esri/arcgis-rest-js`](https://developers.arcgis.com/arcgis-rest-js/) — no
Esri Python stack, no native dependencies.

- **Transport:** stdio
- **Tools:** `search_items`, `portal_info`
- **Auth:** API key · OAuth app login · username/password · anonymous (auto-detected)

---

## Requirements

- Node.js ≥ 20
- [pnpm](https://pnpm.io) (npm works too — see fallback below)

## Setup

```bash
pnpm install
pnpm build      # tsc -> dist/
pnpm start      # runs dist/index.js over stdio
```

<details>
<summary>npm fallback</summary>

```bash
npm install
npm run build
npm start
```

</details>

Other scripts: `pnpm test` (vitest), `pnpm lint` (ESLint), `pnpm format` (Prettier),
`pnpm dev` (tsc watch).

## Configuration

All configuration is via environment variables. The **auth mode is auto-detected**
by precedence — the first matching block wins:

| #   | Environment variables                       | Mode              |
| --- | ------------------------------------------- | ----------------- |
| 1   | `ARCGIS_API_KEY`                            | API key           |
| 2   | `ARCGIS_CLIENT_ID` + `ARCGIS_CLIENT_SECRET` | OAuth app login   |
| 3   | `ARCGIS_USERNAME` + `ARCGIS_PASSWORD`       | Username/password |
| 4   | _(none of the above)_                       | Anonymous         |

Additional variables:

| Variable            | Default                  | Notes                                            |
| ------------------- | ------------------------ | ------------------------------------------------ |
| `ARCGIS_PORTAL_URL` | `https://www.arcgis.com` | ArcGIS Enterprise: your portal base URL          |
| `LOG_LEVEL`         | `info`                   | `debug` \| `info` \| `error` (logs go to stderr) |
| `MCP_TRANSPORT`     | `stdio`                  | Only `stdio` is supported for now                |

See [`.env.example`](./.env.example) for a copy-paste template.

**Auth behavior**

- Auth is **lazy** — the session is built on the first tool call, so the server
  starts even if the portal is unreachable.
- Auth failures come back as a **structured error** in the tool response, never
  a crash.
- Secrets (API keys, tokens, passwords, client secrets) are **never logged** —
  the startup config line is redacted.

## Use with Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "arcgis": {
      "command": "node",
      "args": ["/absolute/path/to/arcgis-mcp/dist/index.js"],
      "env": {
        "ARCGIS_API_KEY": "AAPK...",
        "ARCGIS_PORTAL_URL": "https://www.arcgis.com",
      },
    },
  },
}
```

Use an absolute path to `dist/index.js`, and run `pnpm build` first. Restart
Claude Desktop after editing the config. Swap the `env` block for whichever auth
mode you want (or omit credentials entirely for anonymous).

## Tools

### `search_items`

Search the portal for items (Web Maps, Feature Layers, Apps, Dashboards, …).

| Input        | Type                | Default  | Notes                                                         |
| ------------ | ------------------- | -------- | ------------------------------------------------------------- |
| `query`      | string              | `""`     | Free-text; Esri search syntax allowed                         |
| `itemType`   | string              | –        | e.g. `"Web Map"`, `"Feature Layer"`, `"Dashboard"`            |
| `owner`      | string              | –        | Restrict to one owner; becomes `owner:<value>`                |
| `tags`       | string[]            | –        | AND-combined, quoted                                          |
| `maxItems`   | integer (1–100)     | `10`     |                                                               |
| `sortField`  | string              | –        | `title`, `modified`, `created`, `numviews`, …                 |
| `sortOrder`  | `"asc"` \| `"desc"` | `"desc"` |                                                               |
| `outsideOrg` | boolean             | `false`  | Search public items beyond your org (query must be non-empty) |

By default the search is scoped to your organization (an `orgid:` clause is added
automatically when authenticated). Set `outsideOrg: true` to search public
ArcGIS Online content across organizations — a non-empty query is then required.

Per-item result shape: `id`, `title`, `type`, `owner`, `snippet`, `description`
(truncated to ~500 chars), `tags`, `modified` (ISO-8601), `created` (ISO-8601),
`numViews`, `access`, `serviceUrl`, `itemPage` (a `…/home/item.html?id=…` link
you can open in a browser).

### `portal_info`

No arguments. Triggers auth and returns
`{ portalUrl, authMode, authenticated, username?, fullName?, role?, orgId?, orgName? }`.
The convenient "am I connected correctly?" check.

## Esri query syntax cheatsheet

The `query` field accepts ArcGIS search syntax. A few useful patterns:

| Pattern                         | Meaning                                  |
| ------------------------------- | ---------------------------------------- |
| `roads`                         | Free-text match                          |
| `title:flood`                   | Match a specific field                   |
| `owner:city_gis`                | Items owned by a user                    |
| `type:"Feature Service"`        | Exact item type (quote multi-word types) |
| `tags:"hydrology"`              | Match a tag                              |
| `a AND b` / `a OR b` / `-b`     | Boolean / exclusion                      |
| `modified:[0 TO 1700000000000]` | Range on epoch-millisecond fields        |

Full reference: [Search reference — ArcGIS REST APIs](https://developers.arcgis.com/rest/users-groups-and-items/search-reference/).

## Common item types

`Web Map`, `Web Mapping Application`, `Dashboard`, `Feature Service`,
`Feature Layer`, `Map Service`, `Image Service`, `Vector Tile Service`,
`Web Scene`, `StoryMap`, `Form`, `Notebook`, `Geoprocessing Service`,
`CSV`, `Shapefile`, `File Geodatabase`, `Code Attachment`.

## Roadmap

Plausible next tools:

- `get_item` — full metadata + sharing for a single item id
- `get_webmap_layers` — list operational layers of a Web Map
- `query_feature_layer` — attribute query against a Feature Layer (where clause,
  out fields, result limit)

## Out of scope

No geometry/spatial operations, no Docker, no CI, no Python. Just a clean,
testable library project.
