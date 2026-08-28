---
name: ntn
description: Run Notion CLI (ntn) commands via the `ntn` tool (a direct CLI wrapper, not MCP). Use for any question about Notion pages, databases, data sources, workspace search, or raw API calls — especially when the user references Notion, a page, or a database.
---

## When to Use

Use whenever the user asks about anything in Notion — retrieving or creating pages, editing page content, searching the workspace, querying databases/data sources, resolving database IDs, managing file uploads, or making raw Notion API calls. Triggers: "search my Notion", "get this page", "create a page", "edit the page", "query the database", "find notes in Notion", "ntn api", "upload a file to Notion".

**IMPORTANT**: The `ntn` tool calls the Notion CLI (`ntn`) directly. It is **not** an MCP server — do not use the `mcp` gateway. The `ntn` CLI must be installed and authenticated. If the tool returns "not authenticated", tell the user to run `ntn login` via bash.

**Discovering commands**: the top-level subcommands are `pages`, `datasources`, `files`, `workers` (beta), `api`, `auth`, `whoami`, `login`, `logout`, `doctor`, `update`, and `notion-as-code` (alpha). Run `ntn --help` via bash for the authoritative list, and `ntn api ls` for every public API endpoint. The `api <path>` escape hatch covers any endpoint without a dedicated subcommand.

## Tool reference

The `ntn` tool takes:

- `subcommand` (required, string) — the full ntn CLI command path (e.g. `"pages get <id>"`, `"api /v1/search"`, `"datasources query <id>"`). Top-level parameter — never nest it inside `args`.
- `args` (optional object) — a key/value object of flags ONLY (never an array; do not nest `subcommand`, `data`, or `method` here). Booleans become bare `--flag` (`{json: true}` → `--json`). Strings/numbers become `--flag value` tokens (`{parent: "page:abc123"}` → `--parent page:abc123`). Arrays become repeated `--flag value` pairs. `false`/`null`/`undefined` are skipped.
- `data` (optional string) — request body for `api` calls (translates to `--data <JSON|@path|@->). Pass a JSON string for search queries and mutations.
- `method` (optional string) — HTTP method override for `api` calls (translates to `--method <METHOD>`).
- `timeoutSeconds` (optional, default 30, max 120) — command timeout.
- `forceDangerous` (optional boolean) — opt-in for destructive commands (`pages trash`). Requires explicit user confirmation.

### Call shape

All parameters are TOP-LEVEL siblings. `args` is a key/value object of flags ONLY — never an array, and never nest the other parameters inside it.

```json
{
  "subcommand": "pages get <page-id>",
  "args": { "json": true }
}
```

### Workspace search

There is no top-level `search` subcommand in `ntn`. Workspace search is via the raw API escape hatch:

```json
{
  "subcommand": "api /v1/search",
  "data": "{\"query\":\"meeting notes\",\"filter\":{\"property\":\"object\",\"value\":\"page\"}}"
}
```

This produces `ntn api /v1/search --data '{"query":"meeting notes","filter":{"property":"object","value":"page"}}'`.

## Common ntn subcommands

### Pages

- `pages get <id>` — retrieve a page as Markdown with properties prepended as frontmatter (`args: { json: true }` for raw API JSON).
- `pages create` — create a page from Markdown content (`args: { content: "# Title\n\nBody", parent: "page:<id>" }`). Parent can be `page:<id>`, `database:<id>`, or `data-source:<id>`.
- `pages edit <id>` — edit a page's content from Markdown (`args: { content: "# Updated body" }`).
- `pages trash <id>` — move a page to trash. **Requires `forceDangerous: true`.**

### Data sources

- `datasources query <id>` — query pages in a data source.
- `datasources resolve <db-id>` — resolve a Notion database ID to its data source IDs.

### Files

- `files create` — create a file upload from stdin or an external URL.
- `files get <id>` — retrieve a file upload by id.
- `files list` (alias `files ls`) — list file uploads.

### Workers (Beta)

- `workers` — manage Notion workers. Subcommands: `capabilities`, `create`, `deploy`, `new`, `exec`, `get`, `delete` (alias `rm`), `env`, `oauth`, `databases`. Use `ntn workers --help` (via bash) to see the full list — this surface is beta and evolves.

### Raw API

- `api <path>` — raw Notion API call. Pass the request body via `data` and optionally override the HTTP method via `method`. This is the escape hatch for any endpoint not covered by a dedicated subcommand.
  - `api /v1/search` — search by title (`data: '{"query":"...","filter":{"property":"object","value":"page"}}'`).
  - `api /v1/pages` — create a page (POST; pass body via `data`).
  - `api /v1/pages/<id>` — retrieve or update a page (GET/PATCH).
  - `api /v1/databases/<id>` — retrieve or update a database.
  - `api /v1/blocks/<id>/children` — append block children.
  - `api ls` — list all supported public API endpoints (the full endpoint surface).

### Auth & diagnostics

- `whoami` — show the authenticated Notion user (`args: { json: true }` for raw JSON; `--plain` for TSV).
- `auth token` — print the current authentication token.
- `login` — log in to Notion (browser flow, or `args: { "no-browser": true }` for two-step flow).
- `logout` — log out of Notion.
- `doctor` — check the health of the Notion CLI setup (use to diagnose auth/install issues).
- `update` — update `ntn` to the latest version (`args: { force: true }` to force reinstall).

> `notion-as-code` (alpha, not publicly available) and `help` also exist but are not generally useful via this tool. Run `ntn --help` via bash for the authoritative top-level command list.

## Pitfalls

- **`args` is an object, never an array** — pass `{ json: true }`, not `["--json"]`. The tool tolerates an array but it's not the correct shape.
- **Never nest parameters inside `args`** — `subcommand`, `data`, and `method` are top-level siblings of `args`, not keys inside it.
- **`pages trash` is refused** by the tool unless `forceDangerous: true` is set. Always confirm with the user before using it — moving a page to trash may be hard to reverse.
- **Auth failures** — if the tool returns "not authenticated", tell the user to run `ntn login` via bash. Do NOT retry the tool in a loop.
- **ntn not installed** — if the tool reports `ntn` is not on PATH, tell the user to install the Notion CLI and ensure it's on PATH.
- **`--data` is the request body for `api` calls** — use it for search queries and mutations. Pass a JSON string, `@path` to read from a file, or `@-` to read from stdin.
- **No top-level `search`** — workspace search is `api /v1/search` with a `data` body containing `query` and optionally `filter`.
- **`subcommand` is split on whitespace** — `"pages get abc-123"` becomes `["pages", "get", "abc-123"]`. Do not quote subcommands.
- **Large output is truncated** — the tool caps output at 2000 lines / 50KB. Use `args: { json: true }` for structured output when you need to parse results.

## Verification

1. `ntn` tool with `subcommand: "whoami"` exits 0 and shows the authenticated user.
2. `ntn` tool with `subcommand: "pages get <id>", args: { json: true }` returns page content.
3. For write ops (create, edit, trash), re-query with `pages get <id>` to confirm the change landed before reporting success.
