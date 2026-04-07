# FAM v1.0 — Comprehensive Test Cases

This document describes all the test scenarios for validating FAM end-to-end. It covers both automated tests (Vitest) and manual validation steps.

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

### 1.2 State Management

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.2.1 | Load state.json when it exists | State object returned | Yes |
| 1.2.2 | Return empty state when state.json missing | Empty state with defaults | Yes |
| 1.2.3 | Write state atomically (tmp + rename) | No partial writes on crash | Yes |
| 1.2.4 | State file has 0600 permissions | Owner-only read/write | Yes |

### 1.3 Diff Engine

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 1.3.1 | Compute diff between empty and populated config | All items marked as "add" | Yes |
| 1.3.2 | Compute diff with changes to existing items | Changed items marked as "change" | Yes |
| 1.3.3 | Compute diff with removed items | Removed items marked as "remove" | Yes |
| 1.3.4 | Format diff with Terraform-style +/~/- markers | Human-readable output | Yes |

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

### 2.2 Credential Injection

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.2.1 | Header injection with Bearer token | Authorization header set | Yes |
| 2.2.2 | Environment variable injection | Env var set in process env | Yes |
| 2.2.3 | Query parameter injection | Token appended to URL | Yes |
| 2.2.4 | Custom header name injection | Custom header set | Yes |

### 2.3 OAuth2 Flow

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.3.1 | Get valid token when not expired | Access token returned | Yes |
| 2.3.2 | Get valid token when no expiry set | Token returned (no refresh attempt) | Yes |
| 2.3.3 | Get valid token throws when no token stored | VaultError with helpful message | Yes |
| 2.3.4 | Get token status reports expiry correctly | isExpired, expiresAt accurate | Yes |
| 2.3.5 | Force refresh throws when no refresh token | VaultError with instruction | Yes |
| 2.3.6 | Force refresh throws when no client_secret | VaultError with instruction | Yes |
| 2.3.7 | Initiate flow throws for unknown provider | Lists supported providers | Yes |
| 2.3.8 | Initiate flow throws for non-oauth2 credential | Type mismatch error | Yes |
| 2.3.9 | Initiate flow throws when client_secret missing | Store instruction | Yes |
| 2.3.10 | Browser-based flow completes (manual) | Tokens stored in vault | Manual |

### 2.4 OAuth Provider Registry

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 2.4.1 | All 6 providers have required fields | authorizeHost, authorizePath, tokenHost, tokenPath | Yes |
| 2.4.2 | All hosts use HTTPS | URLs start with https:// | Yes |
| 2.4.3 | Lookup is case-insensitive | "GitHub" finds "github" | Yes |
| 2.4.4 | Unknown provider returns undefined | No crash | Yes |
| 2.4.5 | listProviders returns all names | 6+ providers | Yes |

---

## 3. Config Generators

### 3.1 Generator Output

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 3.1.1 | Claude Code generates valid JSON | mcpServers key with FAM entry | Yes |
| 3.1.2 | Cursor generates valid JSON | mcpServers key | Yes |
| 3.1.3 | VS Code generates valid JSON | servers key with type/url | Yes |
| 3.1.4 | OpenHands generates TOML-like config | Correct format | Yes |
| 3.1.5 | OpenCode generates `mcp` key with `type: "remote"` | OpenCode-specific format | Yes |
| 3.1.6 | Windsurf generates mcpServers JSON | Same as Cursor | Yes |
| 3.1.7 | Zed generates context_servers with `source: "custom"` | Platform-aware path | Yes |
| 3.1.8 | Cline generates mcpServers JSON | VS Code extension format | Yes |
| 3.1.9 | Roo Code generates mcpServers JSON | .roo/mcp.json format | Yes |
| 3.1.10 | Gemini CLI generates mcpServers JSON | ~/.gemini/settings.json | Yes |
| 3.1.11 | GitHub Copilot generates mcpServers JSON | ~/.copilot format | Yes |
| 3.1.12 | Amazon Q generates mcpServers JSON | ~/.aws/amazonq format | Yes |
| 3.1.13 | Generic generates plain MCP server list | Minimal JSON | Yes |
| 3.1.14 | All generators are pure functions (no side effects) | No file I/O in generator | Yes |
| 3.1.15 | Instruction file (FAM.md) generated per profile | Contains profile info + tool list | Yes |

### 3.2 Merge Strategy

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 3.2.1 | Detect existing config file | Returns path and format | Yes |
| 3.2.2 | Create backup (.pre-fam) | Original preserved | Yes |
| 3.2.3 | Import strategy merges FAM entry | Existing keys preserved | Yes |
| 3.2.4 | Overwrite strategy replaces file | Only FAM content remains | Yes |
| 3.2.5 | Skip strategy leaves file unchanged | Original untouched | Yes |

---

## 4. Daemon & MCP Proxy

### 4.1 Server Lifecycle

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.1.1 | Start daemon in foreground mode | Server listening on configured port | Yes (E2E) |
| 4.1.2 | Start daemon in background mode | Process forks, parent exits | Manual |
| 4.1.3 | Stop daemon via SIGTERM | Graceful shutdown, PID file removed | Yes (E2E) |
| 4.1.4 | Atomic PID file (O_EXCL) prevents double-start | DaemonError if already running | Yes |
| 4.1.5 | Stale PID file detected and cleaned | Daemon starts after cleanup | Yes |
| 4.1.6 | Double-shutdown guard | Only one shutdown sequence runs | Yes |
| 4.1.7 | Auto-start install (launchd/systemd) | Plist or unit file created | Manual |

### 4.2 MCP Protocol

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.2.1 | `initialize` returns protocol version + server info | protocolVersion, serverInfo | Yes (E2E) |
| 4.2.2 | `tools/list` returns namespaced tools | `namespace__toolname` format | Yes (E2E) |
| 4.2.3 | `tools/call` forwards to upstream and returns result | Real tool output | Yes (E2E) |
| 4.2.4 | Unknown method returns -32601 error | Method not found | Yes (E2E) |
| 4.2.5 | Invalid JSON-RPC returns -32600 error | Invalid request | Yes |
| 4.2.6 | Missing tool name returns -32602 error | Missing parameter | Yes |

### 4.3 Authentication & Security

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.3.1 | Valid Bearer token authenticates | Profile resolved | Yes (E2E) |
| 4.3.2 | Missing token returns auth error | -32000 error | Yes (E2E) |
| 4.3.3 | Invalid token returns auth error | -32000 error | Yes (E2E) |
| 4.3.4 | Query param token works (`?token=...`) | Profile resolved | Yes |
| 4.3.5 | Token comparison is timing-safe | Uses timingSafeEqual | Yes |
| 4.3.6 | Rate limiting (200 req/min per profile) | 429 after limit | Yes |
| 4.3.7 | Request body limit (1MB) | 413 or connection reset | Yes (E2E) |
| 4.3.8 | `/health` without auth returns minimal info | No server details leaked | Yes (E2E) |
| 4.3.9 | `/health` with auth returns full details | Servers, profiles, uptime | Yes (E2E) |
| 4.3.10 | `/api/v1/reload` only from localhost | 403 from non-localhost | Yes |

### 4.4 Access Control

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 4.4.1 | Profile sees only allowed_servers tools | Denied server tools hidden | Yes (E2E) |
| 4.4.2 | Denied tool returns "Tool not found" (not "denied") | No existence leak | Yes (E2E) |
| 4.4.3 | Profile with empty allowed_servers sees only native tools | No upstream tools | Yes (E2E) |
| 4.4.4 | Native FAM tools always visible to all profiles | fam__* tools present | Yes (E2E) |

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
| 5.1.1 | `fam__whoami` returns profile name + servers | JSON with profile, allowed/denied | Yes |
| 5.1.2 | `fam__log_action` writes to audit | logged: true, audit DB entry | Yes (E2E) |
| 5.1.3 | `fam__log_action` rejects missing action | isError: true | Yes |
| 5.1.4 | `fam__log_action` accepts metadata | Metadata in audit entry | Yes |
| 5.1.5 | `fam__list_servers` shows server status | Server list with tool counts | Yes (E2E) |
| 5.1.6 | `fam__health` returns daemon uptime + version | 1.0.0, uptime > 0 | Yes (E2E) |

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

## 6. Knowledge Store

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 6.1 | Set/get round-trip | Value matches | Yes |
| 6.2 | Upsert overwrites same key+namespace | Updated value | Yes |
| 6.3 | Different namespaces are isolated | Separate entries | Yes |
| 6.4 | FTS5 search finds by value | Matching results | Yes |
| 6.5 | FTS5 search finds by key | Matching results | Yes |
| 6.6 | FTS5 search finds by tags | Matching results | Yes |
| 6.7 | Search with namespace filter | Only matching namespace | Yes |
| 6.8 | List with pagination (limit/offset) | Correct page | Yes |
| 6.9 | Delete removes entry | Get returns null | Yes |
| 6.10 | Delete returns false for non-existent | No error | Yes |
| 6.11 | Tags stored and retrieved as arrays | Correct JSON | Yes |
| 6.12 | Close DB without error | No crash | Yes |

---

## 7. Drift Detection

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 7.1 | No state file -> empty report | hasDrift: false, totalConfigs: 0 | Yes |
| 7.2 | Empty generated_configs -> empty report | No entries | Yes |
| 7.3 | Unchanged file -> status: clean | Hash matches | Yes |
| 7.4 | Modified file -> status: modified | Hash mismatch with both hashes | Yes |
| 7.5 | Missing file -> status: missing | currentHash undefined | Yes |
| 7.6 | Mixed states handled correctly | Correct counts for each | Yes |
| 7.7 | hasDrift is false when all clean | Boolean logic correct | Yes |
| 7.8 | hasDrift is true when any modified or missing | Boolean logic correct | Yes |
| 7.9 | Format report produces readable output | Status icons, summary line | Yes |
| 7.10 | `fam drift --json` outputs valid JSON | Parseable, all fields present | Manual |
| 7.11 | `fam drift --watch` polls every 5s | Repeated output | Manual |
| 7.12 | `fam drift` exits 2 when drift detected | CI-friendly exit code | Manual |

---

## 8. Audit Logging

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 8.1 | MCP call logged with profile, server, tool, status | Row in mcp_calls | Yes (E2E) |
| 8.2 | Config change logged with action, target, details | Row in config_changes | Yes (E2E) |
| 8.3 | Query with profile filter | Only matching profile | Yes |
| 8.4 | Query with time filter (since) | Only recent entries | Yes |
| 8.5 | Export as JSON | Valid JSON with metadata | Yes |
| 8.6 | Export as CSV | Correct headers and escaping | Yes |
| 8.7 | Denied tool call logged as 'denied' | Status column = denied | Yes |
| 8.8 | Error tool call includes error message | errorMsg populated | Yes |
| 8.9 | Latency recorded in milliseconds | latencyMs > 0 | Yes |

---

## 9. CLI Commands

### 9.1 Lifecycle

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.1.1 | `fam init` creates fam.yaml | Interactive YAML created | Manual |
| 9.1.2 | `fam plan` shows pending changes | Terraform-style diff | Yes (E2E) |
| 9.1.3 | `fam apply` generates all configs | Files created, tokens printed | Manual |
| 9.1.4 | `fam validate` checks schema | Schema valid message | Yes (E2E) |
| 9.1.5 | `fam status` shows overview | Credentials, servers, profiles | Manual |

### 9.2 Credentials

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.2.1 | `fam secret set <name>` prompts for value | Hidden input, stored in keychain | Manual |
| 9.2.2 | `fam secret get <name> --yes` prints value | Credential displayed | Manual |
| 9.2.3 | `fam secret list` shows all credentials | Status table | Manual |
| 9.2.4 | `fam secret delete <name>` removes from keychain | Confirmation + removal | Manual |

### 9.3 OAuth2

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.3.1 | `fam auth login <cred>` opens browser | OAuth flow starts | Manual |
| 9.3.2 | `fam auth status` shows all OAuth2 credentials | Expiry, access/refresh status | Manual |
| 9.3.3 | `fam auth refresh <cred>` refreshes token | New access token stored | Manual |
| 9.3.4 | `fam auth providers` lists all providers | 6 providers | Manual |

### 9.4 Knowledge

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.4.1 | `fam knowledge set key value` stores entry | "Stored: key" message | Manual |
| 9.4.2 | `fam knowledge get key` retrieves value | Value printed | Manual |
| 9.4.3 | `fam knowledge search query` returns results | Formatted results | Manual |
| 9.4.4 | `fam knowledge list` shows all entries | Entry table | Manual |
| 9.4.5 | `fam knowledge delete key` removes entry | "Deleted: key" message | Manual |

### 9.5 Drift Detection

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.5.1 | `fam drift` with no changes | "No drift detected" | Manual |
| 9.5.2 | `fam drift` after manual config edit | Shows modified file | Manual |
| 9.5.3 | `fam drift --json` | Valid JSON report | Manual |
| 9.5.4 | `fam drift --watch` | Continuous polling output | Manual |

### 9.6 Daemon

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 9.6.1 | `fam daemon start --foreground` | Logs to stdout, stays attached | Yes (E2E) |
| 9.6.2 | `fam daemon start` (background) | PID printed, process detaches | Manual |
| 9.6.3 | `fam daemon stop` | "Daemon stopped" message | Manual |
| 9.6.4 | `fam daemon restart` | Stop + start sequence | Manual |
| 9.6.5 | `fam daemon status` | PID, uptime, server count | Manual |
| 9.6.6 | `fam daemon install` (macOS) | launchd plist created | Manual |
| 9.6.7 | `fam daemon install` (Linux) | systemd unit created | Manual |
| 9.6.8 | `fam daemon uninstall` | Service file removed | Manual |

---

## 10. Security

| # | Test Case | Expected Result | Automated |
|---|---|---|---|
| 10.1 | Sensitive files have 0600 permissions | state.json, sessions.json, backups | Yes |
| 10.2 | `~/.fam` directory has 0700 permissions | Owner-only access | Yes |
| 10.3 | Session tokens use `fam_sk_<3char>_<64hex>` format | Correct pattern | Yes |
| 10.4 | Token hashes are SHA-256 | 64-char hex digest | Yes |
| 10.5 | Token comparison is timing-safe | timingSafeEqual used | Yes |
| 10.6 | Path traversal rejected | `..` and system dirs blocked | Yes |
| 10.7 | PID file uses O_EXCL (atomic creation) | No TOCTOU race | Yes |
| 10.8 | Generic error messages (no credential leaks) | "not configured" not credential name | Yes |
| 10.9 | Daemon binds only to localhost | 127.0.0.1 | Yes (E2E) |
| 10.10 | Reload only from localhost | 403 from non-localhost | Yes |

---

## 11. Integration Tests (E2E)

The automated E2E test at `test/e2e/full-cycle.test.ts` exercises the full pipeline:

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
12. Security: missing/invalid tokens rejected
13. Security: oversized body rejected
14. Initialize handshake
15. Audit DB verification (direct SQLite query)
16. Graceful shutdown

**Run with:** `npm test`

---

## 12. Manual Validation Checklist

For a full manual smoke test before release:

```bash
# 1. Fresh install
npm install -g @sweetpapatech/fam
fam --version    # Should show 1.0.0

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

# Knowledge store
curl -X POST http://localhost:7865/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fam__set_knowledge","arguments":{"key":"test","value":"hello world"}}}'

curl -X POST http://localhost:7865/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fam__get_knowledge","arguments":{"key":"test"}}}'

# 7. Knowledge CLI
fam knowledge set greeting "Hello from FAM" --tags "test,demo"
fam knowledge get greeting
fam knowledge search "hello"
fam knowledge list

# 8. Drift detection
fam drift                   # Should show "no drift"
# Manually edit a generated config file
fam drift                   # Should show "modified"
fam drift --json            # JSON output

# 9. Audit log
fam log                     # Recent entries
fam log --since 1h          # Last hour

# 10. Stop daemon
fam daemon stop

# 11. Cleanup
rm -rf /tmp/fam-test ~/.fam
```

---

## Test Coverage Summary

| Category | Automated | Manual | Total |
|---|---|---|---|
| Config Engine | 20 | 0 | 20 |
| Credential Vault | 15 | 1 | 16 |
| OAuth2 | 14 | 1 | 15 |
| Config Generators | 17 | 0 | 17 |
| Daemon & Proxy | 30 | 2 | 32 |
| Native MCP Tools | 18 | 0 | 18 |
| Knowledge Store | 12 | 5 | 17 |
| Drift Detection | 9 | 3 | 12 |
| Audit Logging | 9 | 0 | 9 |
| CLI Commands | 6 | 16 | 22 |
| Security | 10 | 0 | 10 |
| E2E Integration | 28 | 12 | 40 |
| **Total** | **188** | **40** | **228** |

**Automated test suite:** 374 tests across 33 files, running in ~8 seconds.
