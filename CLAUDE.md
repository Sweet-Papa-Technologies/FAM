This project follows The Way of the FoFo (see docs/the-way-of-the-fofo-technical-spec.md)
with the following project-specific overrides:

- No Firebase — FAM is a local-first CLI tool with no cloud backend in MVP
- Backend is Fastify (not Express) — see docs/requirements-design.md for rationale
- No Quasar — CLI only in MVP. Desktop UI (Tauri + Vue 3) comes in v1
- SQLite via better-sqlite3 for local storage (not Firestore)
- All other conventions (TypeScript, testing, linting, security, AI workflow) apply as written

docs/requirements-design.md explains the product vision and feature scope.

## Development Commands

- `npm run dev` — Run CLI in development mode (tsx)
- `npm run build` — Build for distribution (tsup)
- `npm run lint` — Lint with ESLint
- `npm run typecheck` — TypeScript type checking
- `npm test` — Run all tests
- `npx tsx src/index.ts <command>` — Run any CLI command in dev

## Key Files

- `src/cli/` — CLI commands (Commander)
- `src/config/` — YAML schema, parser, state, diff engine, model resolution
- `src/config/models.ts` — Model reference resolution (provider/alias → model ID + API key)
- `src/daemon/` — Fastify MCP proxy server
- `src/generators/` — Config file generators (MCP + LLM model config per agent)
- `src/vault/` — OS keychain credential management
- `src/audit/` — SQLite audit logging
- `src/utils/` — Shared utilities (errors, logger, paths, crypto)