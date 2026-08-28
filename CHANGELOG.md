# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-28

### Added
- `ntn` tool: typed wrapper around the Notion `ntn` CLI with `subcommand` + `args`
  map + `data` + `method` + `timeoutSeconds` + `forceDangerous` parameters.
- Prompt guidance injected when a prompt mentions Notion / pages / databases /
  data sources / workspaces.
- Bundled `ntn` skill documenting the tool and common `ntn` commands.
- Safety guards: refuses `pages trash` (delete-class op) unless
  `forceDangerous: true`; detects "not authenticated" and returns actionable
  `ntn login` guidance; output truncation.
- Runtime tolerance for two common mis-shaped calls: `args` as a JSON array
  (positional tokens) and `subcommand`/`data`/`method` nested inside `args`. An
  internal `normalizeParams` step at the `buildArgv`/`runNtn` seams coerces both
  to the correct argv, and `runNtn` normalizes before `assertSafeCommand` so a
  nested dangerous command cannot bypass the guard.
- Single-source content constants (`NTN_CALL_EXAMPLE`, `NTN_ARGS_DESCRIPTION`,
  `NTN_SUBCOMMAND_DESCRIPTION`) wired into the tool description, schema, prompt
  guidelines, `NTN_GUIDANCE`, `SKILL.md`, and `README.md`.
- Tests — pure helpers (`buildArgv`, `normalizeParams`, `assertSafeCommand`,
  `formatOutput`) tested directly, `runNtn` tested via dependency injection at
  the `NtnExec` system boundary; content-contract tests for the guidance
  constants.
- `scripts/link-pi-deps.sh` + `pretest` hook for reproducible test resolution.
- GPL-3.0 license.
