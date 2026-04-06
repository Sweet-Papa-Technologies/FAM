This project follows The Way of the FoFo (see docs/the-way-of-the-fofo-technical-spec.md)
with the following project-specific overrides:

- No Firebase — FAM is a local-first CLI tool with no cloud backend in MVP
- Backend is Fastify (not Express) — see docs/requirements-design.md for rationale
- No Quasar — CLI only in MVP. Desktop UI (Tauri + Vue 3) comes in v1
- SQLite via better-sqlite3 for local storage (not Firestore)
- All other conventions (TypeScript, testing, linting, security, AI workflow) apply as written

docs/requirements-design.md explains the product vision and feature scope.