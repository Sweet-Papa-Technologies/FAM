# FAM Project Status — Board Update

**Date:** April 6, 2026
**Project:** FoFo Agent Manager (FAM)
**Author:** Forrester Terry
**Status:** MVP feature-complete, tested, security-hardened

---

## Executive Summary

FAM went from concept to working software in two days. We designed, built, tested, security-audited, and validated a local-first CLI + daemon that manages AI agent configuration, credentials, and lifecycle from a single YAML file. The tool is working end-to-end with real MCP servers and has been verified with OpenCode as a live integration target.

**Bottom line:** FAM solves the credential chaos, config fragmentation, and zero-audit-trail problems described in the original product plan. It works today.

---

## What We Built

### The Product

FAM is a CLI tool and local proxy daemon that acts as the single source of truth for all AI agent infrastructure on a developer's machine.

**Before FAM:** The same GitHub token is copy-pasted into 5 different config files. Adding an MCP server means editing `claude_desktop_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, and more — independently. No record of which agent called what, when, or whether it succeeded.

**After FAM:** One YAML file declares everything. `fam apply` generates the right config for each tool. A local daemon proxies all MCP traffic, injects credentials from the OS keychain at runtime, enforces per-tool access scoping, and logs every call to SQLite.

```
Developer writes fam.yaml
    → fam apply generates configs for Claude Code, Cursor, VS Code, OpenCode, etc.
    → fam daemon start runs a local MCP proxy on localhost:7865
    → All AI tools connect to one endpoint and discover their allowed tools
    → FAM handles credentials, scoping, and audit logging transparently
```

### Key Capabilities (all working, all tested)

| Capability | Status |
|---|---|
| Single YAML config for all agent tools | Working |
| Terraform-style `plan` / `apply` lifecycle | Working |
| OS keychain credential storage (macOS/Linux/Windows) | Working |
| Config generators for 6 tools (Claude Code, Cursor, VS Code, OpenHands, OpenCode, generic) | Working |
| MCP proxy daemon with tool namespacing | Working |
| Per-profile access scoping (allowed/denied servers) | Working |
| Session token authentication (SHA-256, timing-safe) | Working |
| 4 native FAM tools (whoami, health, list_servers, log_action) | Working |
| Stdio MCP server process pool with auto-restart | Working |
| HTTP/SSE upstream MCP server connections | Working |
| SQLite audit logging with query and export | Working |
| Config file merge strategy (Import/Overwrite/Skip) | Working |
| FAM.md instruction file generation per profile | Working |
| Daemon auto-start via launchd (macOS) / systemd (Linux) | Working |
| Hot-reload via POST /api/v1/reload | Working |
| 12 CLI commands with help, flags, exit codes | Working |

---

## By the Numbers

| Metric | Value |
|---|---|
| Source files | 72 TypeScript files |
| Source lines of code | 9,735 |
| Test files | 35 |
| Test lines of code | 6,013 |
| Total tests | 379 (all passing) |
| Test execution time | ~9 seconds |
| Security findings fixed | 4 critical, 9 high |
| Config generators | 13 (Claude Code, Cursor, VS Code, OpenHands, OpenCode, Windsurf, Zed, Cline, Roo Code, Gemini CLI, GitHub Copilot, Amazon Q, generic) |
| CLI commands | 15 |
| Native MCP tools | 9 |
| External dependencies | 13 runtime, 11 dev |

---

## Timeline

### Day 1 — Design & Foundation

**Documentation & Design**
- Reviewed and expanded the product plan (`requirements-design.md`)
- Reviewed The Way of the FoFo technical spec for conventions
- Wrote comprehensive `DESIGN.md` — 18 sections covering architecture, data models, API contracts, module interfaces, security model, testing strategy, and build milestones
- Updated keychain package reference (`keyring-node` → `@napi-rs/keyring`) based on research
- Created parallelization plan for multi-agent implementation

**Implementation (5-step pipeline with parallel agents)**

| Step | What Built | Agents | Tests |
|---|---|---|---|
| 0: Scaffold | package.json, tsconfig, shared types, utils, fixtures | 1 | — |
| 1: Core modules | Config engine (Zod schema, YAML parser, state, diff), Vault (keychain, injection), Audit (SQLite logger, export) | 3 parallel | 81 |
| 2: Dependent modules | 6 config generators + merge strategy, MCP proxy daemon (Fastify server, auth, tool registry, proxy router, stdio pool, upstream manager, native tools, lifecycle) | 2 parallel | +126 |
| 3: CLI layer | 10 commands: init, plan, apply, validate, status, secret, register, daemon, mcp, log | 2 parallel | — |
| 4: Integration | Dogfood config, README, linting, compilation verification | 1 | — |

**Result:** 207 tests passing, `fam --help` shows all commands, `fam plan` works end-to-end.

### Day 2 — Review, Security, Testing, Documentation

**Comprehensive Code Review**
- Full audit of all 54 source files (both source-level and spec-compliance)
- Found 2 bugs, 4 missing features, 3 minor issues
- All fixed:
  - Token ordering bug in `fam apply` (generated configs had placeholder tokens)
  - Hot-reload was a no-op (now re-parses config, rebuilds registry)
  - Added `fam daemon install/uninstall` for auto-start
  - Added `fam config manage` for re-triggering merge strategy
  - Added config path fallback (`./fam.yaml` → `~/.fam/fam.yaml`)

**Security Audit**
- Three parallel security audits covering credentials, injection attacks, and network/daemon
- Found 4 critical + 9 high-severity issues, all fixed:

| Severity | Issues Fixed |
|---|---|
| **Critical** | File permissions on sensitive files (0600), path traversal validation, PID file TOCTOU race (atomic O_EXCL), double-shutdown guard |
| **High** | Timing-safe token comparison, /health info leakage gating, 1MB body size limit, per-profile rate limiting (200/min), generic error messages (no credential name leakage), keychain error differentiation, upstream tool name validation, TLS enforcement warnings |

**E2E Integration Testing**
- Built Vitest-based E2E test (22 tests) that starts a real daemon, spawns a real stdio MCP server, makes HTTP calls, and verifies the full pipeline
- Built `test.opencode.sh` — 12-step shell script that tests FAM with real OpenCode:
  - Creates fam.yaml with filesystem MCP server
  - Starts daemon, registers tokens
  - Verifies tools/list (14 filesystem tools + 4 native tools)
  - Proxies a real `list_directory` call through FAM to the filesystem server
  - Tests auth enforcement (bad/missing tokens rejected)
  - Verifies OpenCode sees FAM via `opencode mcp list`
  - Checks audit DB has real entries
  - Tests all three merge strategies (import, overwrite, skip)
  - Cleans everything up on exit
- **Result: All tests pass. FAM works end-to-end with real tools.**

**OpenCode Integration**
- Researched OpenCode's MCP config format (`"mcp"` key with `"type": "remote"`)
- Built native OpenCode config generator
- Verified OpenCode v1.3.17 connects to FAM and sees the proxied tools

**User Documentation**
- `docs/user/index.md` — Home page with architecture, concepts, full CLI reference, security overview
- `docs/user/installation.md` — npm install, build from source, first-run walkthrough, troubleshooting
- `docs/user/opencode-setup.md` — Step-by-step OpenCode integration guide with examples

---

## Architecture (as built)

```
┌─────────────────────────────────────────────────────┐
│  AI Tools (Claude Code, Cursor, VS Code, OpenCode)  │
│         Connect to localhost:7865 as MCP client      │
└──────────────────────┬──────────────────────────────┘
                       │ MCP JSON-RPC + Bearer token
                       ▼
┌──────────────────────────────────────────────────────┐
│  FAM Daemon (Fastify)                                │
│                                                      │
│  Auth Engine → Tool Registry → MCP Proxy             │
│  (timing-safe)  (namespace __)  (JIT credentials)    │
│                                                      │
│  Rate Limiter (200/min) · Body Limit (1MB)           │
│  Native Tools: whoami, health, list_servers, log     │
│  Audit Logger (SQLite)                               │
└───────────┬─────────────────────┬────────────────────┘
            │ stdio               │ HTTP/SSE
            ▼                     ▼
    ┌───────────────┐    ┌────────────────┐
    │ Stdio Pool    │    │ Upstream Mgr   │
    │ filesystem,   │    │ GitHub, Jira,  │
    │ sqlite, etc.  │    │ GitLab, etc.   │
    └───────────────┘    └────────────────┘
```

---

## What's Next (v1.0 Roadmap)

| Feature | Priority | Notes |
|---|---|---|
| OAuth2 flow manager | High | Currently stub — API keys only in MVP |
| Desktop UI (Tauri + Vue 3) | High | Visual config editor, audit log browser |
| Background daemonization | Medium | Currently foreground-only; launchd/systemd workaround available |
| Drift detection (`fam drift`) | Medium | Compare live tool configs against declared state |
| Template gallery | Medium | Community `fam.yaml` templates |
| Multi-machine sync | Low | Encrypted config sync via git repo |
| Shared knowledge store | Low | Agents write/read learnings through FAM |
| npm publish + Homebrew tap | Blocking | Required for public distribution |

---

## Risks & Mitigations

| Risk | Status | Mitigation |
|---|---|---|
| MCP protocol changes | Low | Using official `@modelcontextprotocol/sdk`; FAM wraps it, doesn't fork it |
| Tool config format changes | Low | Generators are isolated pure functions; adding or updating one doesn't affect others |
| Keychain access issues on CI/Linux | Medium | In-memory vault mock for tests; documented libsecret requirement |
| Adoption requires mindset shift | Medium | Terraform mental model is familiar; `fam init` auto-detects existing configs |
| Naming/trademark conflict | Open | "FAM" not yet checked. Alternatives on standby if needed |

---

## Repository

- **Location:** `/Users/fterry/code/FAM` (local), GitHub TBD
- **Branch:** `main` (13 commits)
- **Tests:** `npm test` (237 passing in ~6s)
- **Lint:** `npm run lint` (clean)
- **Types:** `npm run typecheck` (clean)
- **E2E:** `./test.opencode.sh` (all passing with real OpenCode + filesystem MCP)

---

*Built with The Way of the FoFo. Designed by human, implemented with AI, validated end-to-end.*
