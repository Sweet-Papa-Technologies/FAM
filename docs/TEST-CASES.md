# FAM v1.0 — Comprehensive Test Cases

This document describes all the test scenarios for validating FAM end-to-end. It covers automated unit tests (Vitest), the in-process E2E test, the Docker-based integration test harness, and manual validation steps.

---

## Test Layers

| Layer | Runner | Tests | Duration | Requirements |
|-------|--------|-------|----------|-------------|
| Unit tests | Vitest (`npm test`) | 453 | ~7s | Node 22 |
| In-process E2E | Vitest (`npm test`) | 27 | ~6s | Node 22 |
| Docker E2E | Standalone (`npm run test:docker`) | 53 | ~2min | Docker |
| Manual | Human | ~40 | varies | FAM installed |

---

## 1. Configuration Engine

### 1.1 YAML Parsing & Validation

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.1.1 | Parse valid fam.yaml with all sections | Zod validation passes, FamConfig returned | Yes |
| 1.1.2 | Parse fam.yaml with `${ENV_VAR}` placeholders | Variables resolved from environment | Yes |
| 1.1.3 | Reject fam.yaml with missing required fields | ConfigError with path info | Yes |
| 1.1.4 | Reject fam.yaml with invalid credential type | Zod discriminatedUnion error | Yes |
| 1.1.5 | Accept fam.yaml with only required fields (defaults fill in) | Defaults applied correctly | Yes |
| 1.1.6 | Config path fallback: `./fam.yaml` -> `~/.fam/fam.yaml` | Uses first found | Yes |
| 1.1.7 | Parse fam.yaml with `models` section | ModelProviderSchema validates, provider/alias refs checked | Yes |
| 1.1.8 | Cross-field validation: model refs point to valid providers | Zod superRefine errors for bad refs | Yes |
| 1.1.9 | Cross-field validation: model credential refs exist | Zod superRefine errors for missing credentials | Yes |

### 1.2 State Management

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.2.1 | Load state.json when it exists | State object returned | Yes |
| 1.2.2 | Return empty state when state.json missing | Empty state with defaults (including `models: {}`) | Yes |
| 1.2.3 | Write state atomically (tmp + rename) | No partial writes on crash | Yes |
| 1.2.4 | State file has 0600 permissions | Owner-only read/write | Yes |

### 1.3 Diff Engine

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.3.1 | Compute diff between empty and populated config | All items marked as "add" | Yes |
| 1.3.2 | Compute diff with changes to existing items | Changed items marked as "change" | Yes |
| 1.3.3 | Compute diff with removed items | Removed items marked as "remove" | Yes |
| 1.3.4 | Format diff with Terraform-style +/~/- markers | Human-readable output | Yes |
| 1.3.5 | Diff detects added model providers | Provider listed in models section diff | Yes |
| 1.3.6 | Diff detects removed model providers | Provider listed as removed | Yes |
| 1.3.7 | Diff detects changed model providers | Credential/alias changes detected | Yes |

### 1.4 Model Resolution

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.4.1 | Parse `provider/alias` reference format | Returns `{ provider, alias }` | Yes |
| 1.4.2 | Parse bare string returns null (backward compat) | No resolution attempted | Yes |
| 1.4.3 | Resolve valid model ref to ResolvedModel | Correct provider, model_id, api_key, base_url | Yes |
| 1.4.4 | Resolve ref with `credential: null` returns `api_key: null` | No vault lookup | Yes |
| 1.4.5 | Resolve ref with unknown provider throws | FamError with helpful message | Yes |
| 1.4.6 | Resolve ref with unknown alias throws | FamError with alias + provider context | Yes |
| 1.4.7 | Credential lookups cached per provider | Single vault call for multiple models from same provider | Yes |
| 1.4.8 | Resolve profile with default model + roles | Full ResolvedModelSet returned | Yes |
| 1.4.9 | Resolve profile with no model returns null | Backward compatible | Yes |
| 1.4.10 | Resolve profile with roles-only uses first role as default | Graceful fallback | Yes |

---

## 2. Credential Vault

### 2.1 Keychain Operations

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.1.1 | Set and get credential round-trip | Value matches | Yes |
| 2.1.2 | Get non-existent credential returns null | No error thrown | Yes |
| 2.1.3 | Exists returns true for stored credential | Boolean true | Yes |
| 2.1.4 | Delete removes credential | Get returns null after | Yes |
| 2.1.5 | List returns status for declared credentials | Correct exists flags | Yes |
| 2.1.6 | Overwrite existing credential | New value stored | Yes |

### 2.2 Keychain Operations (Linux — Docker E2E)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.2.1 | Set and get via real gnome-keyring | Value matches (libsecret backend) | Yes (Docker) |
| 2.2.2 | Overwrite credential in gnome-keyring | New value returned | Yes (Docker) |
| 2.2.3 | Delete credential from gnome-keyring | Returns null after deletion | Yes (Docker) |
| 2.2.4 | Multiple credentials coexist in gnome-keyring | All values retrievable | Yes (Docker) |
| 2.2.5 | Read nonexistent credential returns null | No crash on gnome-keyring | Yes (Docker) |

### 2.3 Credential Injection

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.3.1 | Header injection with Bearer token | Authorization header set | Yes |
| 2.3.2 | Environment variable injection | Env var set in process env | Yes |
| 2.3.3 | Query parameter injection | Token appended to URL | Yes |
| 2.3.4 | Custom header name injection | Custom header set | Yes |

### 2.4 OAuth2 Flow

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.4.1 | Get valid token when not expired | Access token returned | Yes |
| 2.4.2 | Get valid token when no expiry set | Token returned (no refresh attempt) | Yes |
| 2.4.3 | Get valid token throws when no token stored | VaultError with helpful message | Yes |
| 2.4.4 | Get token status reports expiry correctly | isExpired, expiresAt accurate | Yes |
| 2.4.5 | Force refresh throws when no refresh token | VaultError with instruction | Yes |
| 2.4.6 | Force refresh throws when no client_secret | VaultError with instruction | Yes |
| 2.4.7 | Initiate flow throws for unknown provider | Lists supported providers | Yes |
| 2.4.8 | Initiate flow throws for non-oauth2 credential | Type mismatch error | Yes |
| 2.4.9 | Initiate flow throws when client_secret missing | Store instruction | Yes |
| 2.4.10 | Browser-based flow completes (manual) | Tokens stored in vault | Manual |

### 2.5 OAuth Provider Registry

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.5.1 | All 6 providers have required fields | authorizeHost, authorizePath, tokenHost, tokenPath | Yes |
| 2.5.2 | All hosts use HTTPS | URLs start with https:// | Yes |
| 2.5.3 | Lookup is case-insensitive | "GitHub" finds "github" | Yes |
| 2.5.4 | Unknown provider returns undefined | No crash | Yes |
| 2.5.5 | listProviders returns all names | 6+ providers | Yes |

---

## 3. Config Generators

### 3.1 Generator Output (Unit Tests)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 3.1.1 | Claude Code generates valid JSON with mcpServers | FAM entry with url, transport, headers | Yes |
| 3.1.2 | Claude Code model config adds env block | ANTHROPIC_MODEL, ANTHROPIC_API_KEY, tier vars | Yes |
| 3.1.3 | Claude Code env_inject overrides model-derived vars | Explicit env_inject wins | Yes |
| 3.1.4 | Cursor generates valid JSON | mcpServers key, GUI-only model warning | Yes |
| 3.1.5 | VS Code generates servers key with type/url | VS Code-specific format | Yes |
| 3.1.6 | OpenHands generates TOML with [llm] + [mcp] | Model config from resolved models or env_inject fallback | Yes |
| 3.1.7 | OpenCode generates `mcp` key + providers/agents | Coder/task role mapping | Yes |
| 3.1.8 | OpenCode cross-provider task role | Separate provider entries | Yes |
| 3.1.9 | Aider generates YAML with model/editor-model/weak-model | LiteLLM provider/model format | Yes |
| 3.1.10 | Continue.dev generates YAML with models[] + mcpServers | Role-based model entries | Yes |
| 3.1.11 | OpenClaw generates JSON with mcpServers + providers | Model providers with api type | Yes |
| 3.1.12 | OpenClaw models.yaml with tiered config | primary/fallback/economy tiers | Yes |
| 3.1.13 | NemoClaw generates JSON with mcpServers | NEMOCLAW_* env var hints in warnings | Yes |
| 3.1.14 | Windsurf, Zed, Roo Code, Amazon Q generate MCP-only | GUI-only/CLI-hint warnings | Yes |
| 3.1.15 | Cline generates mcpServers + partial model config | cline.apiProvider, cline.apiModelId | Yes |
| 3.1.16 | Gemini CLI generates mcpServers + model.name | GEMINI_API_KEY hint | Yes |
| 3.1.17 | GitHub Copilot generates mcpServers | COPILOT_* env var hints | Yes |
| 3.1.18 | Generic generates plain MCP server list | Minimal JSON | Yes |
| 3.1.19 | Instruction file (FAM.md) generated per profile | Contains profile info + tool list | Yes |

### 3.2 Generator Output (Docker E2E — all 17 agents)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 3.2.1 | All 17 generators produce valid output via `fam apply` | Config files exist with correct format | Yes (Docker) |
| 3.2.2 | Expected dot-path structure present in each output | MCP entry fields verified per agent | Yes (Docker) |
| 3.2.3 | JSON agents parse without error | Valid JSON | Yes (Docker) |
| 3.2.4 | YAML agents parse without error | Valid YAML (including comment-only) | Yes (Docker) |
| 3.2.5 | TOML agents contain expected sections | Raw text section checks | Yes (Docker) |

### 3.3 Merge Strategy

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 3.3.1 | Detect existing config file | Returns path and format | Yes |
| 3.3.2 | Create backup (.pre-fam) | Original preserved | Yes |
| 3.3.3 | Import strategy merges FAM entry | Existing keys preserved | Yes |
| 3.3.4 | Overwrite strategy replaces file | Only FAM content remains | Yes |
| 3.3.5 | Skip strategy leaves file unchanged | Original untouched | Yes |

---

## 4. Daemon & MCP Proxy

### 4.1 Server Lifecycle

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.1.1 | Start daemon in foreground mode | Server listening on configured port | Yes (E2E + Docker) |
| 4.1.2 | Start daemon in background mode | Process forks, parent exits | Manual |
| 4.1.3 | Stop daemon via SIGTERM | Graceful shutdown, PID file removed | Yes (E2E + Docker) |
| 4.1.4 | Atomic PID file (O_EXCL) prevents double-start | DaemonError if already running | Yes |
| 4.1.5 | Stale PID file detected and cleaned | Daemon starts after cleanup | Yes |
| 4.1.6 | Double-shutdown guard | Only one shutdown sequence runs | Yes |
| 4.1.7 | Auto-start install (launchd/systemd) | Plist or unit file created | Manual |

### 4.2 MCP Protocol

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.2.1 | `initialize` returns protocol version + server info | protocolVersion, serverInfo.name = "fam" | Yes (E2E + Docker) |
| 4.2.2 | `tools/list` returns namespaced tools | `namespace__toolname` format | Yes (E2E + Docker) |
| 4.2.3 | `tools/call` forwards to upstream and returns result | Real filesystem tool output | Yes (E2E + Docker) |
| 4.2.4 | Unknown method returns -32601 error | Method not found | Yes (E2E + Docker) |
| 4.2.5 | Invalid JSON-RPC returns -32600 error | Invalid request | Yes |
| 4.2.6 | Missing tool name returns -32602 error | Missing parameter | Yes |

### 4.3 Authentication & Security

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.3.1 | Valid Bearer token authenticates | Profile resolved | Yes (E2E + Docker) |
| 4.3.2 | Missing token returns auth error | -32000 error | Yes (E2E + Docker) |
| 4.3.3 | Invalid token returns auth error | -32000 error | Yes (E2E + Docker) |
| 4.3.4 | Query param token works (`?token=...`) | Profile resolved | Yes |
| 4.3.5 | Token comparison is timing-safe | Uses timingSafeEqual | Yes |
| 4.3.6 | Rate limiting (200 req/min per profile) | 429 after limit | Yes |
| 4.3.7 | Request body limit (1MB) | 413 or connection reset | Yes (E2E) |
| 4.3.8 | `/health` without auth returns minimal info | No server details leaked | Yes (E2E + Docker) |
| 4.3.9 | `/health` with auth returns full details | Servers, profiles, uptime | Yes (E2E + Docker) |
| 4.3.10 | `/api/v1/reload` only from localhost | 403 from non-localhost | Yes |

### 4.4 Access Control

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.4.1 | Profile sees only allowed_servers tools | Denied server tools hidden | Yes (E2E) |
| 4.4.2 | Denied tool returns "Tool not found" (not "denied") | No existence leak | Yes (E2E) |
| 4.4.3 | Profile with empty allowed_servers sees only native tools | No upstream tools | Yes (E2E) |
| 4.4.4 | Native FAM tools always visible to all profiles | fam__* tools present | Yes (E2E + Docker) |

### 4.5 Tool Registry

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.5.1 | Register upstream tools with namespace prefix | `github__repos_list` | Yes |
| 4.5.2 | Register native tools with fam namespace | `fam__whoami` | Yes |
| 4.5.3 | Tool name validation rejects `__` in upstream names | Error thrown | Yes |
| 4.5.4 | Tool name validation rejects special characters | Only alphanumeric + _-. | Yes |
| 4.5.5 | Build per-profile filtered views | Correct tool subsets | Yes |
| 4.5.6 | Resolve tool call splits namespace | Correct namespace + upstream name | Yes |

---

## 5. Native MCP Tools

### 5.1 Original Tools

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 5.1.1 | `fam__whoami` returns profile name + servers | JSON with profile, allowed/denied | Yes (E2E + Docker) |
| 5.1.2 | `fam__log_action` writes to audit | logged: true, audit DB entry | Yes (E2E) |
| 5.1.3 | `fam__log_action` rejects missing action | isError: true | Yes |
| 5.1.4 | `fam__log_action` accepts metadata | Metadata in audit entry | Yes |
| 5.1.5 | `fam__list_servers` shows server status | Server list with tool counts | Yes (E2E + Docker) |
| 5.1.6 | `fam__health` returns daemon uptime + version | 1.0.0, uptime > 0 | Yes (E2E + Docker) |

### 5.2 Knowledge Tools

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 5.2.1 | `fam__set_knowledge` stores entry | stored: true | Yes (E2E) |
| 5.2.2 | `fam__get_knowledge` retrieves by key | Entry with value, tags, namespace | Yes (E2E) |
| 5.2.3 | `fam__get_knowledge` returns not-found for missing key | found: false | Yes |
| 5.2.4 | `fam__search_knowledge` finds via full-text search | Matching entries | Yes (E2E) |
| 5.2.5 | `fam__search_knowledge` filters by namespace | Only matching namespace | Yes |
| 5.2.6 | Knowledge store uninitialized returns error | Helpful error message | Yes |

### 5.3 Audit & Profile Tools

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 5.3.1 | `fam__get_audit_log` returns recent entries | entries array with count | Yes (E2E) |
| 5.3.2 | `fam__get_audit_log` filters by profile | Only matching profile | Yes |
| 5.3.3 | `fam__list_profiles` returns all profiles | Name, description, servers | Yes (E2E) |

---

## 6. LLM Model Configuration

### 6.1 Model Config Pipeline (Docker E2E)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 6.1.1 | Claude Code: model provider → `env.ANTHROPIC_MODEL` | Model ID in generated JSON env block | Yes (Docker) |
| 6.1.2 | OpenCode: model provider → `agents.coder.model` | Model ID in coder agent config | Yes (Docker) |
| 6.1.3 | OpenHands: model provider → `model =` in TOML | Model ID in [llm] section | Yes (Docker) |
| 6.1.4 | Aider: model provider → `model:` in YAML | LiteLLM-format model line | Yes (Docker) |
| 6.1.5 | Continue.dev: model provider → `models[]` array | Provider + model in models list | Yes (Docker) |
| 6.1.6 | OpenClaw: model provider → `models.providers` | Provider section with api type | Yes (Docker) |
| 6.1.7 | Cline: model provider → `cline.apiModelId` | Model ID in settings key | Yes (Docker) |
| 6.1.8 | Gemini CLI: model provider → `model.name` | Model name in settings JSON | Yes (Docker) |

---

## 7. Knowledge Store

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 7.1 | Set/get round-trip | Value matches | Yes |
| 7.2 | Upsert overwrites same key+namespace | Updated value | Yes |
| 7.3 | Different namespaces are isolated | Separate entries | Yes |
| 7.4 | FTS5 search finds by value | Matching results | Yes |
| 7.5 | FTS5 search finds by key | Matching results | Yes |
| 7.6 | FTS5 search finds by tags | Matching results | Yes |
| 7.7 | Search with namespace filter | Only matching namespace | Yes |
| 7.8 | List with pagination (limit/offset) | Correct page | Yes |
| 7.9 | Delete removes entry | Get returns null | Yes |
| 7.10 | Delete returns false for non-existent | No error | Yes |
| 7.11 | Tags stored and retrieved as arrays | Correct JSON | Yes |
| 7.12 | Close DB without error | No crash | Yes |

---

## 8. Drift Detection

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 8.1 | No state file -> empty report | hasDrift: false, totalConfigs: 0 | Yes |
| 8.2 | Empty generated_configs -> empty report | No entries | Yes |
| 8.3 | Unchanged file -> status: clean | Hash matches | Yes |
| 8.4 | Modified file -> status: modified | Hash mismatch with both hashes | Yes |
| 8.5 | Missing file -> status: missing | currentHash undefined | Yes |
| 8.6 | Mixed states handled correctly | Correct counts for each | Yes |
| 8.7 | hasDrift is false when all clean | Boolean logic correct | Yes |
| 8.8 | hasDrift is true when any modified or missing | Boolean logic correct | Yes |
| 8.9 | Format report produces readable output | Status icons, summary line | Yes |
| 8.10 | `fam drift` after clean apply → no drift | Exit code 0 | Yes (Docker) |
| 8.11 | `fam drift` after config modification → drift detected | Exit code 2 | Yes (Docker) |
| 8.12 | `fam drift --json` outputs valid JSON | Parseable, all fields present | Manual |
| 8.13 | `fam drift --watch` polls every 5s | Repeated output | Manual |

---

## 9. Audit Logging

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.1 | MCP call logged with profile, server, tool, status | Row in mcp_calls | Yes (E2E) |
| 9.2 | Config change logged with action, target, details | Row in config_changes | Yes (E2E) |
| 9.3 | Query with profile filter | Only matching profile | Yes |
| 9.4 | Query with time filter (since) | Only recent entries | Yes |
| 9.5 | Export as JSON | Valid JSON with metadata | Yes |
| 9.6 | Export as CSV | Correct headers and escaping | Yes |
| 9.7 | Denied tool call logged as 'denied' | Status column = denied | Yes |
| 9.8 | Error tool call includes error message | errorMsg populated | Yes |
| 9.9 | Latency recorded in milliseconds | latencyMs > 0 | Yes |

---

## 10. CLI Commands

### 10.1 Lifecycle (Docker E2E)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 10.1.1 | `fam plan` shows pending changes | Terraform-style diff output | Yes (E2E + Docker) |
| 10.1.2 | `fam validate` checks schema | "Config schema valid" message | Yes (E2E + Docker) |
| 10.1.3 | `fam apply --yes` generates all configs | Files created, tokens printed, state.json written | Yes (Docker) |
| 10.1.4 | `fam status` shows overview | Daemon info, config info | Yes (Docker) |
| 10.1.5 | `fam plan` after apply shows no changes | "No changes" or "up-to-date" | Yes (Docker) |
| 10.1.6 | `fam init` creates fam.yaml | Interactive YAML created | Manual |

### 10.2 Credentials

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 10.2.1 | `fam secret set <name>` prompts for value | Hidden input, stored in keychain | Manual |
| 10.2.2 | `fam secret get <name> --yes` prints value | Credential displayed | Manual |
| 10.2.3 | `fam secret list` shows all credentials | Status table | Manual |
| 10.2.4 | `fam secret delete <name>` removes from keychain | Confirmation + removal | Manual |

### 10.3 OAuth2

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 10.3.1 | `fam auth login <cred>` opens browser | OAuth flow starts | Manual |
| 10.3.2 | `fam auth status` shows all OAuth2 credentials | Expiry, access/refresh status | Manual |
| 10.3.3 | `fam auth refresh <cred>` refreshes token | New access token stored | Manual |
| 10.3.4 | `fam auth providers` lists all providers | 6 providers | Manual |

### 10.4 Daemon

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 10.4.1 | `fam daemon start --foreground` | Logs to stdout, stays attached | Yes (E2E + Docker) |
| 10.4.2 | `fam daemon start` (background) | PID printed, process detaches | Manual |
| 10.4.3 | `fam daemon stop` | "Daemon stopped" message | Manual |
| 10.4.4 | `fam daemon restart` | Stop + start sequence | Manual |
| 10.4.5 | `fam daemon status` | PID, uptime, server count | Manual |

---

## 11. Agent Integration (Docker E2E)

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 11.1 | Claude Code installs via npm in Docker | Binary available, config generated | Yes (Docker) |
| 11.2 | Aider installs via pip in Docker | Binary on PATH, `.aider.conf.yml` generated | Yes (Docker) |
| 11.3 | OpenClaw installs via npm in Docker | Binary available, `openclaw.json` + `models.yaml` generated | Yes (Docker) |
| 11.4 | OpenHands pip install (dependency conflict) | Graceful skip with error message | Yes (Docker, skip) |
| 11.5 | Config output verified for all installable agents | Generated files exist and are valid | Yes (Docker) |

---

## 12. Security

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 12.1 | Sensitive files have 0600 permissions | state.json, sessions.json, backups | Yes |
| 12.2 | `~/.fam` directory has 0700 permissions | Owner-only access | Yes |
| 12.3 | Session tokens use `fam_sk_<3char>_<64hex>` format | Correct pattern | Yes |
| 12.4 | Token hashes are SHA-256 | 64-char hex digest | Yes |
| 12.5 | Token comparison is timing-safe | timingSafeEqual used | Yes |
| 12.6 | Path traversal rejected | `..` and system dirs blocked | Yes |
| 12.7 | PID file uses O_EXCL (atomic creation) | No TOCTOU race | Yes |
| 12.8 | Generic error messages (no credential leaks) | "not configured" not credential name | Yes |
| 12.9 | Daemon binds only to localhost | 127.0.0.1 | Yes (E2E) |
| 12.10 | Reload only from localhost | 403 from non-localhost | Yes |
| 12.11 | No root/admin required for install or runtime | User-level keychain, port > 1024 | Yes (Docker) |

---

## 13. In-Process E2E Test

The automated E2E test at `test/e2e/full-cycle.test.ts` exercises the full pipeline in a single vitest run (27 tests):

1. Write fam.yaml to temp dir
2. `fam plan` -> verify diff output
3. Generate session tokens
4. Start daemon in foreground
5. `/health` (unauthenticated + authenticated)
6. `tools/list` (verify namespaced tools + all 9 native tools)
7. `tools/call` on real filesystem tool
8. All native tools: whoami, health, list_servers, log_action
9. Knowledge store: set, get, search (via MCP)
10. Audit log query + profile listing (via MCP)
11. Access control: restricted profile sees no upstream tools
12. Security: missing/invalid tokens rejected, oversized body rejected
13. Initialize handshake
14. Audit DB verification (direct SQLite query)
15. Graceful shutdown

**Run with:** `npm test`

---

## 14. Docker E2E Test Harness

The Docker test harness at `test/docker-e2e/` runs 53 tests in a Linux container with real gnome-keyring, real agent installations, and isolated test contexts.

### Categories

| Category | Tests | What It Covers |
|----------|-------|---------------|
| core-cli | 7 | `fam plan`, `fam apply --yes`, `fam validate`, `fam status`, `fam drift` |
| daemon | 12 | Startup, health endpoints, tools/list, tools/call, auth, native tools, shutdown |
| generators | 17 | All 17 agents: generate config via apply, validate format + structure |
| vault | 5 | Real gnome-keyring: set/get/delete/overwrite via @napi-rs/keyring |
| agent-integration | 4 | Install Claude Code, Aider, OpenClaw; verify config; run verify command |
| model-config | 8 | Model provider resolution: verify model fields in generated configs per agent |

### Running

```bash
# Full suite
npm run test:docker

# Single category
bash test/docker-e2e/run.sh vault
bash test/docker-e2e/run.sh daemon
bash test/docker-e2e/run.sh generators

# Custom LLM endpoint
E2E_LLM_URL=http://localhost:11434/v1 npm run test:docker
```

### Latest Results

```
52 passed, 0 failed, 1 skipped (53 total) in 120s

Skipped:
  - agent-openhands: pip dependency conflict (upstream issue)
```

---

## 15. Manual Validation Checklist

For a full manual smoke test before release:

```bash
# 1. Fresh install
git clone https://github.com/Sweet-Papa-Technologies/FAM.git && cd FAM
nvm use 22
npm install && npm run build && npm link

# 2. Initialize
mkdir /tmp/fam-test && cd /tmp/fam-test
fam init         # Create fam.yaml interactively

# 3. Add a real MCP server to fam.yaml
# Add filesystem server (safe, no credentials needed):
#   filesystem:
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/fam-test"]
#     transport: stdio
#     description: "Local filesystem"

# 4. Plan and apply
fam plan                    # Should show additions
fam apply                   # Generate configs + tokens

# 5. Start daemon
fam daemon start --foreground

# 6. Test with curl (in another terminal)
TOKEN="<paste token from apply output>"

# Health check
curl http://localhost:7865/health
curl -H "Authorization: Bearer $TOKEN" http://localhost:7865/health

# Tools list
curl -X POST http://localhost:7865/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST http://localhost:7865/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"filesystem__list_directory","arguments":{"path":"/tmp/fam-test"}}}'

# 7. Drift detection
fam drift                   # Should show "no drift"
# Manually edit a generated config file
fam drift                   # Should show "modified"

# 8. Audit log
fam log                     # Recent entries
fam log --since 1h          # Last hour

# 9. Stop daemon
fam daemon stop

# 10. Cleanup
rm -rf /tmp/fam-test ~/.fam
```

---

## Test Coverage Summary

| Category | Unit | E2E (in-process) | Docker E2E | Manual | Total |
|---|---|---|---|---|---|
| Config Engine | 28 | 2 | 7 | 0 | 37 |
| Model Resolution | 18 | 0 | 8 | 0 | 26 |
| Credential Vault | 8 | 0 | 5 | 4 | 17 |
| OAuth2 | 30 | 0 | 0 | 1 | 31 |
| Config Generators | 51 | 0 | 17 | 0 | 68 |
| Daemon & Proxy | 29 | 16 | 12 | 2 | 59 |
| Native MCP Tools | 35 | 9 | 0 | 0 | 44 |
| Knowledge Store | 25 | 3 | 0 | 0 | 28 |
| Drift Detection | 11 | 0 | 2 | 2 | 15 |
| Audit Logging | 23 | 1 | 0 | 0 | 24 |
| CLI Commands | 0 | 2 | 7 | 10 | 19 |
| Agent Integration | 0 | 0 | 4 | 0 | 4 |
| Security | 10 | 2 | 0 | 0 | 12 |
| **Total** | **268** | **35** | **62** | **19** | **384** |

**Automated tests:** 453 unit + E2E (Vitest) + 53 Docker E2E = **506 total automated tests**
