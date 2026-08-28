# pi-ntn

[![CI](https://github.com/sfroment/pi-ntn/actions/workflows/ci.yml/badge.svg)](https://github.com/sfroment/pi-ntn/actions/workflows/ci.yml)
[![Release](https://github.com/sfroment/pi-ntn/actions/workflows/release.yml/badge.svg)](https://github.com/sfroment/pi-ntn/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@sfroment/pi-ntn.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-ntn)
[![npm downloads](https://img.shields.io/npm/dm/@sfroment/pi-ntn.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-ntn)
[![npm bundle size](https://img.shields.io/bundlephobia/min/@sfroment/pi-ntn.svg?cacheSeconds=120)](https://bundlephobia.com/package/@sfroment/pi-ntn)
[![GitHub Release](https://img.shields.io/github/v/release/sfroment/pi-ntn.svg?cacheSeconds=120)](https://github.com/sfroment/pi-ntn/releases)
[![GitHub stars](https://img.shields.io/github/stars/sfroment/pi-ntn.svg?cacheSeconds=120)](https://github.com/sfroment/pi-ntn/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/sfroment/pi-ntn.svg?cacheSeconds=120)](https://github.com/sfroment/pi-ntn/commits)
[![GitHub commits since latest release](https://img.shields.io/github/commits-since/sfroment/pi-ntn/latest.svg?cacheSeconds=120)](https://github.com/sfroment/pi-ntn/releases)
[![license](https://img.shields.io/npm/l/@sfroment/pi-ntn.svg?cacheSeconds=120)](https://github.com/sfroment/pi-ntn/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fd4b3a?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that wraps the official Notion `ntn` CLI as a single typed tool — **directly**, not via an MCP server.

## What it provides

- an `ntn` custom tool with typed parameters (`subcommand` + `args` map + `data` + `method` + `timeoutSeconds` + `forceDangerous`)
- a bundled `SKILL.md` documenting the tool and common `ntn` commands
- per-turn prompt guidance when a prompt mentions Notion, pages, databases, data sources, or workspaces
- graceful detection of the "not authenticated" failure with actionable guidance
- a safety guard that refuses `pages trash` unless `forceDangerous: true` is set

## Why not MCP?

The `ntn` CLI already exposes the full Notion API (pages, databases, data sources, search, raw API) and uses the user's existing `ntn login` credentials. Wrapping it in a typed pi tool gives structured, discoverable parameters and output truncation without an extra server process — and replaces the `notion` MCP server.

## Requirements

- `ntn` CLI on PATH — [notion.so](https://notion.so)
- Authenticated via `ntn login`

## Installation

Drop the extension into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local), then reload:

```text
/reload
```

Or install from git:

```bash
pi install git:github.com/sfroment/pi-ntn
```

## Tool parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subcommand` | `string` | The full ntn subcommand path (e.g. `"pages get <id>"`, `"api /v1/search"`, `"datasources query <id>"`). Top-level — never nest inside `args`. |
| `args` | `object` | A key/value object of flags ONLY — **never an array**, and do not nest `subcommand`/`data`/`method` here. Booleans → bare `--flag` (`{json: true}` → `--json`). Strings/numbers → `--flag value` (`{parent: "page:abc"}` → `--parent page:abc`). Arrays → repeated `--flag value` pairs. `false`/`null`/`undefined` are skipped. |
| `data` | `string` | Request body for `api` calls — a JSON string, `@path`, or `@-` for stdin (translates to `--data`). |
| `method` | `string` | HTTP method override for `api` calls (translates to `--method`). |
| `timeoutSeconds` | `integer` | Command timeout (default 30, max 120). |
| `forceDangerous` | `boolean` | Opt-in for `pages trash` (the delete-class op). Requires explicit user confirmation. |

## Examples

Get a page as Markdown:

```json
{
  "subcommand": "pages get <page-id>",
  "args": { "json": true }
}
```

Search the workspace:

```json
{
  "subcommand": "api /v1/search",
  "data": "{\"query\":\"meeting notes\",\"filter\":{\"property\":\"object\",\"value\":\"page\"}}"
}
```

## Development

```bash
bun test          # pretest links pi runtime deps automatically
bunx tsc --noEmit # type-check
```

## License

GPL-3.0

## Links

- **Author:** [Sacha Froment](https://sacha42.com)
- **Source:** <https://github.com/sfroment/pi-ntn>
- **Issues:** <https://github.com/sfroment/pi-ntn/issues>
