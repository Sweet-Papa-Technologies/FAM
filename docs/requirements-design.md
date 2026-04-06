# FoFo Agent Manager (FAM) — Product Plan v0.1

> **"One config. Every agent."** 🦝
>
> A local-first daemon that acts as the universal source of truth for AI agent configuration, credentials, and lifecycle management.
>
> CLI: `fam` · Config: `fam.yaml` · Mascot: The Tanuki

---

## 1. Feature Scope

### MVP (v0.1) — "The Filing Cabinet"

The MVP is a **CLI + local daemon** that solves the three most painful problems today: credential chaos, config fragmentation, and zero audit trail. Ship in 8–12 weeks.

| Feature | Description | Priority |
|---|---|---|
| **`fam.yaml` schema** | Single declarative file defining all agents, MCP servers, credentials, tools, and permissions | P0 |
| **CLI: `init`, `plan`, `apply`, `sync`** | Terraform-style lifecycle commands. `plan` shows a diff, `apply` writes tool-specific configs | P0 |
| **MCP proxy daemon** | Local daemon (Unix socket + localhost TCP) that proxies MCP calls, injecting credentials at runtime. Agent tools point to `localhost:7865` instead of individual MCP servers | P0 |
| **OS keychain credential vault** | Secrets stored in macOS Keychain / Windows Credential Manager / Linux libsecret. Never written to config files | P0 |
| **Config generators** | Generate `claude_desktop_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, etc. from the single YAML source | P0 |
| **Per-tool scoping** | Define which agent tools can access which MCP servers and credentials | P0 |
| **Structured audit log** | Every proxied MCP call logged with timestamp, caller identity, upstream target, success/failure. SQLite-backed | P0 |
| **`fam mcp add/remove/list`** | CLI commands to manage MCP server registry, auto-propagated to all configured tools | P1 |
| **`fam secret set/get/list`** | CLI commands to manage credentials in the OS keychain | P1 |
| **Session tokens for callers** | `fam register <tool>` issues a scoped bearer token. Proxy validates caller identity beyond localhost trust | P1 |
| **`fam validate`** | Pre-apply validation: is the MCP endpoint reachable? Does the model exist? Are credentials present for all required services? | P1 |
| **`fam status`** | Show running daemon health, connected tools, recent activity summary | P2 |
| **AGENTS.md generation** | Auto-generate an `AGENTS.md` file from the FAM config for cross-tool project context | P2 |
| **FAM-as-MCP-server** | Expose FAM itself as an MCP endpoint. Any MCP-capable tool connects to `localhost:7865/mcp`, calls `tools/list`, and gets its scoped tools. Universal connector for Paperclip, custom scripts, any framework | P0 |
| **Native tools: `whoami`, `log_action`, `list_servers`, `health`** | FAM's own tools appear in `tools/list` alongside proxied tools. Agents see one flat list, don't need to know the difference | P1 |
| **`FAM.md` instruction file generation** | Auto-generated per-profile instruction files for agent self-onboarding. Include in system prompts, `AGENTS.md`, or project context | P1 |

### v1.0 — "The Control Plane"

After the CLI is proven with real daily use, add the UI, onboarding, and team features. Ship 3–6 months after MVP.

| Feature | Description |
|---|---|
| **Desktop UI (Tauri)** | Browse agents, MCP servers, credentials, audit logs. Visual config editor. Lightweight, not Electron |
| **Bundled local model** | Optional one-click Ollama install + Qwen 2.5-7B or Gemma 4 E4B download for zero-API-key quickstart |
| **Agent chat UI** | Simple prompt interface to talk to any configured agent through FAM |
| **Template gallery** | Community-contributed `fam.yaml` templates (like Terraform modules). `fam template apply coding-assistant` |
| **OAuth flow manager** | Browser-based OAuth dance for MCP servers that need it. Token refresh handled automatically by daemon |
| **Drift detection** | `fam drift` compares live tool configs against declared state. Alerts on out-of-band changes |
| **Shared knowledge store** | Agents can write learnings back to FAM (`fam knowledge set`). Namespaced key-value with natural language descriptions. Any agent can query it |
| **Multi-machine sync** | Encrypted sync of config (not secrets) across machines via git repo or simple cloud store. Secrets stay in local keychains |
| **Terraform provider** | `terraform-provider-fam` for teams that want to manage agent configs alongside their infra |
| **Plugin system** | Custom config generators for new tools, custom proxy middleware (rate limiting, content filtering) |

### v2.0 — "Enterprise" (Future Vision)

| Feature | Description |
|---|---|
| **Team credential sharing** | Encrypted credential distribution (like 1Password for Teams but for agent secrets) |
| **RBAC and SSO** | Role-based access control for who can configure which agents. SAML/OIDC SSO |
| **Compliance reporting** | Map agent actions to EU AI Act / SOC 2 requirements. Exportable audit reports |
| **Central policy server** | Define org-wide guardrails: "no agent may access production databases without approval" |
| **A2A protocol support** | Inter-agent communication brokered and logged through FAM |

---

## 2. Build vs. Leverage

The philosophy: **build the glue, leverage everything else.**

### We Build From Scratch

| Component | Why |
|---|---|
| **`fam.yaml` schema & parser** | This IS the product. The schema defines what an agent is at the infrastructure level. Nobody else has made this opinionated call |
| **Config generators** | Each tool's config format is simple JSON, but the mapping from our schema to each format is our core IP |
| **MCP proxy routing layer** | The logic that says "this request from Claude Code is allowed to hit GitLab but not Jira" — that's our scoping/permissions engine |
| **`plan` / `apply` / `drift` engine** | The diff algorithm comparing desired state to current state. Terraform's core insight, applied to agent configs |
| **CLI interface** | Our primary UX surface. Needs to feel as polished as `terraform` or `docker` CLI |
| **Audit log schema & writer** | Our opinionated log format for agent actions. The thing that makes compliance possible |

### We Leverage (Don't Reinvent)

| Component | Library / Tool | Notes |
|---|---|---|
| **OS keychain access** | `@napi-rs/keyring` (Rust-based, NAPI-RS bindings) | Active successor to deprecated `keytar`. Uses macOS Keychain, Windows Credential Manager, Linux libsecret. Cross-platform, prebuilt binaries |
| **MCP protocol handling** | `@modelcontextprotocol/sdk` (official TS SDK) | Handles MCP message parsing, transport (stdio via `StdioClientTransport`, SSE, streamable HTTP). Stdio transport manages child process spawn, stdin/stdout JSON-RPC framing, and lifecycle. We route to it, not rewrite it |
| **OAuth2 client flows** | `simple-oauth2` (npm, ~90K weekly downloads) | Clean client library for authorization_code, client_credentials, refresh_token grants. We orchestrate it, don't implement OAuth from scratch |
| **OAuth provider configs** | `grant` (npm, 200+ providers) | Pre-built OAuth configs for GitHub, Google, Slack, Jira, etc. as JSON objects. Transparent proxy pattern |
| **YAML parsing** | `yaml` (npm, official YAML 1.2 library) | Schema validation via JSON Schema or Zod |
| **Schema validation** | `zod` | TypeScript-first schema validation for the `fam.yaml` |
| **CLI framework** | `commander` or `oclif` | `commander` for MVP simplicity. `oclif` (by Salesforce/Heroku) if we need plugin architecture later |
| **Local daemon / HTTP server** | `fastify` | Lightweight, fast, plugin-based. Serves the MCP proxy and local API |
| **SQLite for audit logs** | `better-sqlite3` | Synchronous, embedded, zero-config. Perfect for local audit storage |
| **Desktop UI (v1)** | `Tauri` + Vue 3 | You already know Vue/Quasar. Tauri is Rust-based, ~600KB binary vs Electron's 100MB+. Pairs with your existing stack |
| **Local model integration** | `Ollama` (CLI/API) | Don't bundle a model runner. Shell out to Ollama's REST API. Let them handle the hard part |
| **Config file watching** | `chokidar` | Watch for out-of-band config changes (drift detection) |
| **Diff engine** | `diff` (npm) or `json-diff` | For generating human-readable plan output |
| **Process management** | `pm2` or native `systemd`/`launchd` | Daemon auto-restart and lifecycle management |

### We Explicitly Don't Build

| Component | Why Not |
|---|---|
| **Another agent framework** | Not competing with LangChain, CrewAI, etc. We manage their configs, not replace them |
| **A model runner** | Ollama exists. We integrate with it, we don't replicate it |
| **A full observability platform** | Langfuse, LangSmith exist. We produce audit logs that can feed into them |
| **Terraform itself** | We generate Terraform configs or act as a provider, we don't rebuild HCL |
| **An OAuth server** | We're an OAuth client that handles token lifecycle. We don't issue tokens |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DEVELOPER MACHINE                         │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │ Claude Code   │   │ Cursor       │   │ OpenHands / Gemini   │ │
│  │              │   │              │   │ CLI / Paperclip      │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘ │
│         │ MCP calls         │ MCP calls             │ MCP calls  │
│         │ (session token)   │ (session token)       │            │
│         └───────────────────┼───────────────────────┘            │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                   FAM DAEMON                           ││
│  │                   localhost:7865 / Unix socket               ││
│  │                                                              ││
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  ││
│  │  │ MCP PROXY    │  │ AUTH ENGINE   │  │ CONFIG ENGINE      │  ││
│  │  │              │  │              │  │                    │  ││
│  │  │ • Route by   │  │ • Validate   │  │ • Parse YAML      │  ││
│  │  │   namespace  │  │   session    │  │ • Generate tool    │  ││
│  │  │ • Inject     │  │   tokens     │  │   configs          │  ││
│  │  │   credentials│  │ • Check      │  │ • Compute diffs    │  ││
│  │  │ • Forward    │  │   per-tool   │  │ • Detect drift     │  ││
│  │  │   upstream   │  │   scoping    │  │                    │  ││
│  │  └──────┬───────┘  └──────┬───────┘  └────────────────────┘  ││
│  │         │                 │                                   ││
│  │         ├─── HTTP servers: forward upstream with creds        ││
│  │         ├─── Stdio servers: route to process pool below       ││
│  │         │                                                     ││
│  │  ┌──────▼────────────────────────────────────────────────┐   ││
│  │  │          STDIO PROCESS POOL                            │   ││
│  │  │  Spawned on daemon start, supervised, auto-restarted  │   ││
│  │  │  MCP SDK StdioClientTransport per server instance      │   ││
│  │  │  ~30-50MB/process · async I/O · no threading needed   │   ││
│  │  └───────────────────────────────────────────────────────┘   ││
│  │                                                              ││
│  │  ┌───────────────────────────────────────────────────────┐   ││
│  │  │              CREDENTIAL VAULT                          │   ││
│  │  │  @napi-rs/keyring → OS Keychain (macOS/Win/Linux)         │   ││
│  │  │  • API keys, OAuth tokens, service account keys       │   ││
│  │  │  • Pulled just-in-time, never cached in memory        │   ││
│  │  └───────────────────────────────────────────────────────┘   ││
│  │                                                              ││
│  │  ┌───────────────────────────────────────────────────────┐   ││
│  │  │              AUDIT LOG (SQLite)                         │   ││
│  │  │  • Every MCP call: who, what, when, result             │   ││
│  │  │  • Every config change: before/after, who applied      │   ││
│  │  │  • Exportable as JSON/CSV for compliance               │   ││
│  │  └───────────────────────────────────────────────────────┘   ││
│  └──────────────────────────────────────────────────────────────┘│
│                             │                                    │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                   UPSTREAM MCP SERVERS (HTTP/SSE)              ││
│  │  GitHub  │  Jira  │  GitLab  │  GCP  │  Slack  │  Custom    ││
│  │                                                               ││
│  │                   LOCAL STDIO SERVERS (managed by daemon)      ││
│  │  filesystem  │  sqlite  │  memory  │  custom-scripts          ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  fam.yaml          (source of truth)                   ││
│  │  ~/.fam/           (daemon state, audit DB, sessions)  ││
│  │  ~/.fam/configs/   (generated tool configs)            ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Request Flow

```
1. Claude Code makes MCP call → localhost:7865/github/repos/list
2. Daemon receives request, extracts session token from header
3. Auth engine validates: "Is this Claude Code's token? Is Claude Code
   allowed to access the 'github' namespace?"
4. Credential vault pulls GitHub PAT from OS keychain (just-in-time)
5. MCP proxy forwards request to upstream GitHub MCP server with
   real credentials injected
6. Response flows back through proxy to Claude Code
7. Audit log records: [timestamp] claude-code → github.repos.list → 200 OK
```

### CLI Flow

```
$ fam init
  → Creates fam.yaml with scaffold + interactive prompts

$ fam plan
  → Parses fam.yaml
  → Compares against current state (~/.fam/state.json)
  → Shows diff:
      + Adding MCP server: github (api.github.com)
      ~ Updating claude-code: adding gitlab access
      - Removing credential: old-jira-token (expired)

$ fam apply
  → Writes tool-specific configs:
      ✓ ~/.config/claude/claude_desktop_config.json
      ✓ ~/.cursor/mcp.json
      ✓ .vscode/mcp.json
  → Stores new credentials in OS keychain
  → Updates daemon routing table
  → Records change in audit log

$ fam status
  → Daemon: running (PID 12345, uptime 3d 4h)
  → MCP servers: 5 configured, 5 reachable
  → Tools: claude-code (active), cursor (active), openhands (idle)
  → Last 24h: 142 proxied calls, 0 errors
```

---

## 4. Integration Model — How Tools Connect

FAM supports three integration modes. Different tools will use different modes — and some will use more than one.

### Mode 1: Transparent Proxy (MCP-native tools, zero integration)

For tools that already speak MCP — Claude Code, Cursor, VS Code, Gemini CLI, OpenHands. They don't know FAM exists. Their config just points to `localhost:7865` and they think they're talking to GitHub or Jira directly. FAM is invisible middleware.

```
Claude Code → localhost:7865/github/... → FAM injects creds → GitHub MCP
```

This is the **primary mode** and covers ~80% of use cases. The tool's generated config file (produced by `fam apply`) handles the wiring. Zero custom code needed.

### Mode 2: FAM AS an MCP Server (universal connector)

FAM itself IS an MCP server. Any tool that can connect to an MCP endpoint can connect to FAM and dynamically discover what it's allowed to use — via MCP's built-in `tools/list` method.

```
Any agent connects → localhost:7865/mcp (standard MCP client connection)

Agent calls tools/list
FAM responds (filtered by caller's profile):
  - n8n.trigger_workflow
  - n8n.list_workflows
  - n8n.get_execution
  - filesystem.read_file
  - filesystem.list_directory
  - fam.log_action          ← native tool
  - fam.whoami              ← native tool
  (github, gitlab, jira — scoped out for this profile)

Agent calls n8n.trigger_workflow({workflow_id: "art-gen"})
FAM routes to n8n MCP server, injects creds, returns result
```

The agent doesn't need to know about FAM internals. It sees a flat list of available tools and calls them like any MCP tools. Profile scoping in `fam.yaml` controls what shows up per caller.

**This is how Paperclip, custom scripts, or any new agent framework integrates.** Add one MCP server config pointing to `localhost:7865/mcp` and you're done. Discovery is automatic.

### Mode 3: Instruction File (for LLMs and unstructured agents)

For tools that are smart but need natural-language guidance — direct LLM prompts, agent frameworks without native MCP, or agents that benefit from context about *when* and *how* to use their tools.

`fam apply` auto-generates an `FAM.md` from the YAML config:

```markdown
## Available Infrastructure (via FAM)

You have access to a local MCP server at localhost:7865 that provides
authenticated access to the following services. Connect as a standard
MCP client — all authentication is handled for you.

### Your profile: paperclip
### Available tools:
- **n8n**: Trigger and monitor workflows
  - n8n.trigger_workflow, n8n.list_workflows, n8n.get_execution
- **filesystem**: Read files in /home/forrester/projects/fofo-art
  - filesystem.read_file, filesystem.list_directory

### FAM tools:
- **fam.log_action**: Report significant actions for audit trail
- **fam.whoami**: Check your profile and permissions

### Usage:
Connect via MCP at localhost:7865/mcp. All credentials are managed
automatically. Do not hardcode or request any API keys.
```

This file can be included in system prompts, `AGENTS.md`, project context, or any agent's instruction set. It's the self-onboarding pattern — the instruction file IS the onboarding.

### Integration Examples

| Tool | Mode | Setup |
|---|---|---|
| Claude Code | Mode 1 (transparent proxy) | `fam apply` writes config, Claude Code sees MCP servers at localhost |
| Cursor | Mode 1 (transparent proxy) | Same — generated `.cursor/mcp.json` points to FAM |
| Paperclip CEO | Mode 2 (MCP server) | Add `localhost:7865/mcp` as MCP server in Paperclip config. Agent discovers tools via `tools/list` |
| OpenHands | Mode 1 + Mode 3 | Proxy for MCP tools + `FAM.md` in project context for guidance |
| Custom Python script | Mode 2 (MCP server) | Connect with MCP SDK client, call `tools/list`, use tools |
| Direct LLM prompt | Mode 3 (instruction file) | Paste `FAM.md` into context, LLM knows what's available |
| n8n workflow | REST API | Hit FAM's REST API directly (same routes as MCP, simpler protocol) |

### FAM Native Tools

Beyond proxying upstream MCP servers, FAM exposes its own tools in the `tools/list` response. These appear alongside proxied tools — the agent sees one flat list and doesn't need to know the difference.

**MVP native tools:**

| Tool | Description |
|---|---|
| `fam.whoami` | Returns caller's profile name, allowed servers, and permissions |
| `fam.log_action` | Agent reports a significant action for the audit trail. Params: `{action, description, metadata?}` |
| `fam.list_servers` | Returns all MCP servers available to this profile with descriptions |
| `fam.health` | Returns daemon health, server reachability status |

**v1 native tools:**

| Tool | Description |
|---|---|
| `fam.get_knowledge` | Query the shared knowledge store. Params: `{namespace, key?}` |
| `fam.set_knowledge` | Write a learning/fact to the knowledge store. Params: `{namespace, key, value, description}` |
| `fam.search_knowledge` | Fuzzy search across all knowledge the caller can access |
| `fam.get_audit_log` | Retrieve recent audit entries (admin profiles only) |
| `fam.list_profiles` | List all profiles and their access (admin profiles only) |

---

## 5. Sample `fam.yaml` Schema

```yaml
# fam.yaml — FoFo Agent Manager Configuration
# This is the single source of truth for all your AI agent infrastructure.

version: "0.1"

# ─── Global Settings ────────────────────────────────────────────
settings:
  daemon:
    port: 7865                      # TCP port for MCP proxy
    socket: ~/.fam/agent.sock # Unix domain socket (preferred)
    auto_start: true                # Start daemon on login
  audit:
    enabled: true
    retention_days: 90
    export_format: json             # json | csv | otlp
  sync:
    enabled: false                  # v1: multi-machine sync
    method: git                     # git | s3

# ─── Credentials ────────────────────────────────────────────────
# Secrets are stored in the OS keychain, NOT in this file.
# This section declares what credentials exist and how to obtain them.
# `fam secret set github-pat` stores the actual value securely.

credentials:
  github-pat:
    type: api_key
    description: "GitHub Personal Access Token"
    env_var: GITHUB_TOKEN           # Also injectable as env var
    rotate_after_days: 90           # Reminder to rotate

  anthropic-key:
    type: api_key
    description: "Anthropic API Key"
    env_var: ANTHROPIC_API_KEY

  google-oauth:
    type: oauth2
    description: "Google Workspace OAuth"
    provider: google
    client_id: ${GOOGLE_CLIENT_ID}  # Can reference env vars for non-secrets
    scopes:
      - https://www.googleapis.com/auth/drive.readonly
      - https://www.googleapis.com/auth/calendar.readonly

  jira-oauth:
    type: oauth2
    description: "Jira Cloud OAuth"
    provider: atlassian
    client_id: ${JIRA_CLIENT_ID}
    scopes:
      - read:jira-work
      - write:jira-work

  gitlab-token:
    type: api_key
    description: "Stanford GitLab PAT"
    env_var: GITLAB_TOKEN

# ─── MCP Servers ────────────────────────────────────────────────
# These are the upstream MCP servers FAM proxies to.
# Each gets a namespace (e.g., localhost:7865/github/...)

mcp_servers:
  github:
    url: https://api.githubcopilot.com/mcp/
    transport: sse
    credential: github-pat
    description: "GitHub repos, issues, PRs"

  jira:
    url: https://mcp.atlassian.com/v1/sse
    transport: sse
    credential: jira-oauth
    description: "Jira issue tracking"

  gitlab:
    url: https://gitlab.example.com/mcp
    transport: streamable_http
    credential: gitlab-token
    description: "Stanford GitLab"

  google-drive:
    url: https://gdrive.mcp.claude.com/mcp
    transport: streamable_http
    credential: google-oauth
    description: "Google Drive access"

  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/forrester/projects"]
    transport: stdio
    description: "Local filesystem access"
    # No credential needed — local process

  n8n:
    url: http://localhost:5678/mcp
    transport: sse
    credential: null
    description: "Local n8n workflow engine"
    # Localhost, no auth needed

# ─── Agent Tool Profiles ────────────────────────────────────────
# Define which tools can access what.
# FAM generates tool-specific config files from these profiles.

profiles:
  claude-code:
    description: "Claude Code — primary coding agent"
    config_target: claude_code       # Config generator to use
    model: claude-sonnet-4           # Informational / for validation
    allowed_servers:
      - github
      - gitlab
      - filesystem
      - n8n
    denied_servers:
      - jira                         # Explicitly blocked — use Cursor for PM work
    env_inject:                      # Extra env vars to inject
      ANTHROPIC_API_KEY: credential:anthropic-key

  cursor:
    description: "Cursor IDE"
    config_target: cursor
    allowed_servers:
      - github
      - jira
      - gitlab
      - google-drive
    max_tools: 35                    # Cursor has a 40 tool limit, leave headroom

  vscode:
    description: "VS Code with Copilot"
    config_target: vscode
    allowed_servers:
      - github
      - filesystem

  openhands:
    description: "OpenHands coding agent"
    config_target: openhands
    allowed_servers:
      - github
      - gitlab
      - filesystem
    env_inject:
      LLM_API_KEY: credential:anthropic-key
      LLM_MODEL: claude-sonnet-4

  paperclip:
    description: "Paperclip CEO agent — FoFo Art automation"
    config_target: generic           # Generic MCP config output
    allowed_servers:
      - n8n
    denied_servers:
      - github
      - gitlab                       # Paperclip has no business in our repos

# ─── Config Generators ──────────────────────────────────────────
# Maps profile config_target to output paths and formats.
# Built-in generators: claude_code, cursor, vscode, openhands, generic
# Custom generators can be added as plugins (v1).

generators:
  claude_code:
    output: ~/.claude/settings.json
    format: claude_mcp_config

  cursor:
    output: ~/.cursor/mcp.json
    format: cursor_mcp_config

  vscode:
    output: .vscode/mcp.json
    format: vscode_mcp_config

  openhands:
    output: ~/.openhands/config.toml
    format: openhands_config

  generic:
    output: ~/.fam/configs/${profile_name}.json
    format: generic_mcp_list

# ─── Native Tools ────────────────────────────────────────────────
# Tools that FAM itself exposes in tools/list responses.
# These appear alongside proxied tools — agents see one flat list.

native_tools:
  log_action:
    enabled: true
    description: "Agents report significant actions for audit trail"
  whoami:
    enabled: true
    description: "Returns caller's profile, allowed servers, permissions"
  list_servers:
    enabled: true
    description: "Returns available MCP servers for caller's profile"
  health:
    enabled: true
    description: "Daemon and server reachability status"

# ─── Instruction File Generation ────────────────────────────────
# Auto-generate FAM.md for agent onboarding / self-discovery.
# Produced on `fam apply`, one per profile.

instructions:
  enabled: true
  output_dir: ~/.fam/instructions/
  # Per-profile overrides:
  per_profile:
    paperclip:
      extra_context: |
        You are the Paperclip CEO agent for FoFo Art automation.
        Use n8n workflows for image generation and fulfillment.
        Log all significant actions via fam.log_action.
    claude-code:
      inject_into: AGENTS.md         # Append to existing AGENTS.md
      extra_context: |
        You are working on Stanford EED and SPT projects.
        Use GitLab for Stanford repos, GitHub for SPT repos.

# ─── Knowledge Store (v1) ───────────────────────────────────────
# Shared learnings that any agent can read/write.
# Namespaced to prevent collisions.

# knowledge:
#   namespaces:
#     eed:
#       description: "Stanford EED team conventions"
#       writable_by: [claude-code, cursor]
#     spt:
#       description: "Sweet Papa Technologies project context"
#       writable_by: [claude-code, paperclip]

# ─── Guardrails (v1) ────────────────────────────────────────────
# Global rules enforced at the proxy layer.

# guardrails:
#   - name: no-production-writes
#     description: "Block write operations to production systems outside business hours"
#     condition: "server.tags contains 'production' AND time.hour < 8 OR time.hour > 18"
#     action: deny
#
#   - name: rate-limit-api-calls
#     description: "Max 100 API calls per minute per tool"
#     condition: "calls_per_minute > 100"
#     action: throttle
```

---

## 6. What `fam plan` Output Looks Like

```
$ fam plan

🦝 FAM v0.1.0 — Planning changes...

Credential changes:
  + github-pat          (will prompt for value on apply)
  + anthropic-key       (will prompt for value on apply)
  ~ google-oauth        (token expires in 3 days — will refresh on apply)
    jira-oauth          (no changes)
    gitlab-token        (no changes)

MCP server changes:
  + n8n                 → http://localhost:5678/mcp (sse, no auth)
    github              → https://api.githubcopilot.com/mcp/ (no changes)
    jira                → https://mcp.atlassian.com/v1/sse (no changes)
    gitlab              → https://gitlab.example.com/mcp (no changes)
    google-drive        → https://gdrive.mcp.claude.com/mcp (no changes)
    filesystem          → npx @modelcontextprotocol/server-filesystem (no changes)

Profile changes:
  ~ claude-code         + n8n access (was: github, gitlab, filesystem)
    cursor              (no changes)
    vscode              (no changes)
    openhands           (no changes)
  + paperclip           NEW profile (servers: n8n)

Config files to update:
  ~ ~/.claude/settings.json           (adding n8n server)
  + ~/.fam/configs/paperclip.json (new file)

Validation:
  ✓ All MCP endpoints reachable
  ✓ All credentials present in keychain (except 2 new — will prompt)
  ✓ Cursor profile: 12 tools (under 40 limit)
  ⚠ OpenHands: LLM_MODEL 'claude-sonnet-4' not validated (no model registry)

Plan: 2 to add, 2 to change, 0 to destroy.

Fam's ready when you are. Run `fam apply` to execute.
```

---

## 7. Tech Stack Summary

```
Language:       TypeScript (Node.js 22+)
CLI:            commander → oclif (when plugins needed)
Daemon:         fastify (HTTP/WebSocket) + fastify-websocket
MCP handling:   @modelcontextprotocol/sdk
Credential:     @napi-rs/keyring (Rust/NAPI-RS → OS keychain)
OAuth:          simple-oauth2 + grant (provider configs)
Schema:         zod (validation) + yaml (parsing)
Storage:        better-sqlite3 (audit log + state)
Diff engine:    json-diff (plan output)
File watching:  chokidar (drift detection)
Desktop UI:     Tauri + Vue 3 + Tailwind (v1)
Local models:   Ollama REST API integration (v1)
Package:        npm (CLI), Homebrew tap, AUR (linux)
```

---

## 8. Project Structure (MVP)

```
fam/
├── src/
│   ├── cli/                    # CLI commands
│   │   ├── init.ts
│   │   ├── plan.ts
│   │   ├── apply.ts
│   │   ├── sync.ts
│   │   ├── status.ts
│   │   ├── mcp.ts              # mcp add/remove/list
│   │   └── secret.ts           # secret set/get/list
│   ├── daemon/                 # Local proxy daemon
│   │   ├── server.ts           # Fastify server setup
│   │   ├── proxy.ts            # MCP proxy routing
│   │   ├── stdio-pool.ts       # Stdio server process manager (spawn, supervise, restart)
│   │   ├── auth.ts             # Session token validation
│   │   ├── native-tools.ts    # FAM-native MCP tools (whoami, log_action, etc.)
│   │   └── lifecycle.ts        # Start/stop/health
│   ├── config/                 # Config engine
│   │   ├── schema.ts           # Zod schema for fam.yaml
│   │   ├── parser.ts           # YAML → validated config
│   │   ├── state.ts            # Current state management
│   │   └── diff.ts             # Plan/drift diff engine
│   ├── generators/             # Tool-specific config generators
│   │   ├── claude-code.ts
│   │   ├── cursor.ts
│   │   ├── vscode.ts
│   │   ├── openhands.ts
│   │   ├── generic.ts
│   │   └── instructions.ts    # FAM.md generator per profile
│   ├── vault/                  # Credential management
│   │   ├── keychain.ts         # @napi-rs/keyring wrapper
│   │   ├── oauth.ts            # OAuth flow orchestration
│   │   └── inject.ts           # Runtime credential injection
│   ├── audit/                  # Audit logging
│   │   ├── logger.ts           # SQLite audit writer
│   │   ├── schema.sql          # Audit table definitions
│   │   └── export.ts           # JSON/CSV export
│   └── index.ts                # CLI entry point
├── fam.yaml              # Dogfood: our own config
├── package.json
├── tsconfig.json
└── README.md
```

---

## 9. Open Questions for Design Phase

1. **YAML vs HCL vs TOML?** — YAML is most familiar to the target audience (DevOps, platform eng). HCL would signal "we're serious about IaC" but adds a parser dependency. Leaning YAML.

2. **~~Daemon always-on vs on-demand?~~** — **RESOLVED.** Always-on. The daemon manages stdio child processes and holds session state — spinning up/down adds complexity for no real benefit. Use `launchd` (macOS) / `systemd` (Linux) for auto-start on login. Idle memory footprint is negligible.

3. **~~How do stdio MCP servers work through the proxy?~~** — **RESOLVED.** Spawn all stdio MCP servers as detached child processes on daemon startup. Keep them alive. The MCP SDK's `StdioClientTransport` handles JSON-RPC framing over stdin/stdout — we just maintain a map of `namespace → StdioClientTransport instance` and route requests to the right one. If a process dies, respawn it automatically. If it fails 3+ times within 60 seconds, mark it degraded, log an error, warn the admin, and stop retrying until manually reset. Each stdio server is ~30-50MB in memory — negligible. No lazy spawning, no cold starts, no complexity. Node's async I/O handles concurrency across multiple stdio streams natively without threading.

4. **Config file ownership** — If FAM writes `~/.cursor/mcp.json`, what happens when Cursor also writes to it? Need a strategy: own the whole file, or merge into existing? Leaning toward a managed section with clear comments (`# Managed by FAM — do not edit below this line`).

5. **How opinionated on model configuration?** — Should `fam.yaml` track which model each tool uses, or just manage the MCP/credential layer? Starting narrow (MCP + creds only) seems safer.

6. **Naming** — "FAM" works but check trademark. Alternatives: `fofo-hub`, `agentctl`, `mcpd` (MCP daemon), `fofo-vault`. The name should signal "infrastructure" not "another framework."

---

## 10. Implementation Spec

This section provides the concrete technical decisions needed to implement the MVP. Where the right answer is obvious, it's stated as a decision. Where taste is required, options are presented with a recommendation.

---

### 10.1 MCP Proxy Routing

**Decision: The daemon is a full MCP server, not an HTTP path-prefix router.**

FAM runs as an MCP server using the official `@modelcontextprotocol/sdk`. Agent tools connect to it as they would any MCP server — via SSE or streamable HTTP at `localhost:7865/mcp`. The daemon aggregates all upstream tools into a single `tools/list` response, filtered by the caller's profile.

When a tool call comes in, the daemon routes by **tool name prefix**:

```
Incoming call: github__repos__list
                ^^^^^^
                namespace prefix → route to github MCP server

Incoming call: fam__whoami
                ^^^^^^^^^
                namespace prefix → handle internally (native tool)
```

**How tool namespacing works:**

On startup, the daemon connects to each upstream MCP server (HTTP or stdio), calls `tools/list` on each, and builds a unified registry. Each tool is prefixed with its namespace from `fam.yaml`:

```
Upstream github server exposes:  repos_list, issues_create, pr_merge
FAM presents them as:      github__repos_list, github__issues_create, github__pr_merge

Upstream n8n server exposes:     trigger_workflow, list_workflows
FAM presents them as:      n8n__trigger_workflow, n8n__list_workflows
```

Double underscore (`__`) as namespace separator — single underscore is too common in tool names, slash conflicts with URLs, dot conflicts with JSON paths.

**Why this approach over path-prefix HTTP routing:**

- MCP protocol handles capability negotiation, streaming, and error codes natively
- Agent tools already know how to talk to MCP servers — no custom client needed
- `tools/list` gives automatic discovery — no separate API to build
- Profile-based filtering happens at the `tools/list` level — clean and simple
- The proxy is transport-agnostic: upstream can be stdio, SSE, or streamable HTTP — the agent tool always sees one MCP connection

**The generated config files** that `fam apply` writes just point each tool at the daemon as a single MCP server:

```json
// Generated ~/.cursor/mcp.json
{
  "mcpServers": {
    "fam": {
      "url": "http://localhost:7865/mcp",
      "transport": "sse"
    }
  }
}
```

One entry. Not five. That's the whole point.

---

### 10.2 Session Tokens and Caller Authentication

**Decision: Bearer tokens over HTTP, with query param fallback for MVP.**

When a tool registers with FAM, it gets a session token:

```bash
$ fam register claude-code
✓ Registered profile 'claude-code'
  Token: fam_sk_cld_a1b2c3d4e5f6...
  Add this to your MCP server config as a header:
  "headers": { "Authorization": "Bearer fam_sk_cld_a1b2c3d4e5f6..." }
```

The token is stored in `~/.fam/sessions.json` (mapping token hash → profile name). The daemon validates the token on every request, looks up which profile it maps to, and applies that profile's scoping rules.

**Transport-specific auth:**

| Transport | How token is sent | Notes |
|---|---|---|
| SSE / streamable HTTP | `Authorization: Bearer <token>` header | Standard approach |
| Query param fallback | `localhost:7865/mcp?token=fam_sk_...` | For MCP clients that don't support custom headers |
| Stdio | Not applicable | Stdio connections are internal — spawned by the daemon itself |

**~~TASTE CALL~~ DECIDED: Require tokens always (Option A).** No token = rejected. Every tool must `fam register` before use. Tokens are one CLI command to set up, and this enables per-profile scoping and meaningful audit trails — you can always tell Claude Code's calls apart from Paperclip's.

**Token lifecycle:**

- Tokens don't expire by default (local-only, low risk)
- `fam register --rotate claude-code` generates new token, invalidates old
- `fam register --revoke claude-code` removes access entirely

---

### 10.3 State File Format

**Decision: `~/.fam/state.json` tracks everything the daemon has applied.**

Written atomically on every `fam apply`. Serves as the "last known applied state" for computing diffs.

```json
{
  "version": "0.1",
  "last_applied": "2026-04-06T14:30:00Z",
  "applied_config_hash": "sha256:abc123...",

  "credentials": {
    "github-pat": {
      "type": "api_key",
      "keychain_account": "github-pat",
      "exists_in_keychain": true,
      "last_set": "2026-03-15T00:00:00Z",
      "rotate_after_days": 90
    },
    "google-oauth": {
      "type": "oauth2",
      "keychain_account": "google-oauth:access_token",
      "exists_in_keychain": true,
      "token_expires": "2026-04-07T14:30:00Z",
      "refresh_token_exists": true
    }
  },

  "mcp_servers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "transport": "sse",
      "credential": "github-pat",
      "last_reachable": "2026-04-06T14:29:55Z",
      "tools_discovered": ["repos_list", "issues_create", "pr_merge"]
    },
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/forrester/projects"],
      "status": "running",
      "tools_discovered": ["read_file", "list_directory", "write_file"]
    }
  },

  "profiles": {
    "claude-code": {
      "session_token_hash": "sha256:def456...",
      "allowed_servers": ["github", "gitlab", "filesystem", "n8n"],
      "tools_exposed_count": 18
    },
    "paperclip": {
      "session_token_hash": "sha256:ghi789...",
      "allowed_servers": ["n8n"],
      "tools_exposed_count": 3
    }
  },

  "generated_configs": {
    "claude-code": {
      "path": "~/.cursor/mcp.json",
      "last_written": "2026-04-06T14:30:00Z",
      "content_hash": "sha256:jkl012..."
    }
  }
}
```

**How `plan` uses this:**

1. Parse `fam.yaml` (desired state)
2. Load `state.json` (last applied state)
3. Diff each section — credentials, mcp_servers, profiles, generated_configs
4. For credentials: if YAML declares one not in state → "new credential, will prompt on apply"
5. For MCP servers: compare URLs, transports, credential bindings
6. For profiles: compare allowed_servers lists, compute tool count changes
7. For configs: hash the would-be-generated content, compare to `content_hash`

---

### 10.4 Config Generator Contract

**Decision: Each generator is a pure function with an interactive three-path merge strategy.**

```typescript
interface GeneratorInput {
  profile: Profile;
  settings: GlobalSettings;
  sessionToken: string;
}

interface FileOutput {
  path: string;
  fam_entry: object;     // The FAM MCP server entry to add
  strategy: 'import_and_manage' | 'overwrite' | 'skip';
}
```

Since all tools point to FAM as a **single MCP server entry**, the generated config is always just one key:

```json
{
  "mcpServers": {
    "fam": {
      "url": "http://localhost:7865/mcp?token=fam_sk_cld_a1b2c3d4e5f6...",
      "transport": "sse"
    }
  }
}
```

**~~TASTE CALL~~ DECIDED: Three-path interactive merge on first apply.**

When `fam apply` encounters an **existing config file** for the first time, it prompts with three options:

```
$ fam apply

🦝 Found existing config: ~/.cursor/mcp.json
   Contains 3 MCP servers: github-copilot, local-sqlite, my-custom-api

   [I] Import — Bring existing servers into fam.yaml and manage everything
       through FAM going forward. FAM adds them to your config and proxies
       them alongside your other servers. Original file backed up.

   [O] Overwrite — Replace with FAM-only config. Your existing servers
       won't be managed. Original file backed up to
       ~/.cursor/mcp.json.pre-fam

   [S] Skip — Don't touch this file. You'll manage it manually.
       (You can still connect this tool to FAM by adding the entry yourself.)

   Choice [I/O/S]:
```

**Path I — Import and Manage:**

1. Parse existing config file
2. For each MCP server found, create a corresponding entry in `fam.yaml` under `mcp_servers:` (prompting for any missing credential info)
3. Back up original to `<file>.pre-fam`
4. Write new config with FAM as the sole MCP entry (since all imported servers are now proxied through FAM)
5. Record in state.json: `"import_source": "<original_file_hash>"`

```
🦝 Importing from ~/.cursor/mcp.json...
   + Added github-copilot to fam.yaml (url: https://api.github.com/mcp)
   + Added local-sqlite to fam.yaml (stdio: npx @mcp/sqlite)
   ⚠ my-custom-api uses an API key — run `fam secret set my-custom-api-key`
   ✓ Backed up original → ~/.cursor/mcp.json.pre-fam
   ✓ Wrote new config with FAM proxy entry

   Fam's got your old servers now. They're all proxied through FAM.
```

**Path O — Overwrite:**

1. Back up original to `<file>.pre-fam`
2. Write fresh config with only the FAM MCP entry
3. Existing non-FAM servers stop working through this tool (user can re-add them to `fam.yaml` later or restore the backup)

```
🦝 Backed up → ~/.cursor/mcp.json.pre-fam
   ✓ Wrote FAM-only config

   Your old servers aren't gone — restore anytime from the backup,
   or add them to fam.yaml and let FAM manage them.
```

**Path S — Skip:**

1. Don't write anything to this file
2. Log in state.json: `"strategy": "skip"`
3. On subsequent `fam apply` runs, skip this file silently (don't re-prompt)
4. User can change this later with `fam config manage <profile>`

```
🦝 Skipping ~/.cursor/mcp.json — you're on your own for this one.
   To connect manually, add this to your config:

   "fam": {
     "url": "http://localhost:7865/mcp?token=fam_sk_...",
     "transport": "sse"
   }
```

**Subsequent applies (after first run):**

Once the strategy is recorded in state.json, `fam apply` runs non-interactively:
- **Import/Overwrite profiles:** upsert the `fam` key in the config file, preserve anything else. No prompt.
- **Skip profiles:** don't touch the file. No prompt.
- `fam config manage <profile>` re-triggers the interactive prompt if the user wants to change strategy.

**Implementation:**

```typescript
async function applyConfig(profile: Profile, state: State): Promise<void> {
  const targetPath = getConfigPath(profile);
  const existingStrategy = state.generated_configs[profile.name]?.strategy;

  if (existingStrategy === 'skip') return;

  if (!existingStrategy && fs.existsSync(targetPath)) {
    // First time — interactive prompt
    const choice = await promptImportOverwriteSkip(targetPath);
    if (choice === 'import') await importExistingConfig(targetPath, profile);
    if (choice === 'overwrite') await backupAndOverwrite(targetPath, profile);
    if (choice === 'skip') { state.setStrategy(profile.name, 'skip'); return; }
  }

  // Normal apply: upsert FAM entry
  const existing = safeParseJSON(targetPath) ?? { mcpServers: {} };
  existing.mcpServers.fam = buildFamEntry(profile);
  fs.writeFileSync(targetPath, JSON.stringify(existing, null, 2));
}

---

### 10.5 Keychain Storage Schema

**Decision: Consistent `fam/<name>` naming convention.**

```
Service:  "fam"
Account:  "<credential_name>"           → for API keys
Account:  "<credential_name>:access"    → for OAuth access tokens
Account:  "<credential_name>:refresh"   → for OAuth refresh tokens
Account:  "<credential_name>:expires"   → for OAuth token expiry
```

Using `@napi-rs/keyring` (class-based Entry API):

```typescript
import { Entry } from '@napi-rs/keyring'

// API key
const entry = new Entry('fam', 'github-pat')
entry.setPassword('ghp_abc123...')
const token = entry.getPassword()

// OAuth (multiple entries per credential)
new Entry('fam', 'google-oauth:access').setPassword('<access_token>')
new Entry('fam', 'google-oauth:refresh').setPassword('<refresh_token>')
new Entry('fam', 'google-oauth:expires').setPassword('2026-04-07T14:30:00Z')

// List: no "list all" API — enumerate names from fam.yaml and probe each
// Delete
new Entry('fam', 'github-pat').deletePassword()
```

**CLI:**

```bash
$ fam secret set github-pat
  Enter value for github-pat: ****
  ✓ Stored in system keychain

$ fam secret list
  github-pat       api_key    ✓ stored   (rotation reminder in 75 days)
  anthropic-key    api_key    ✓ stored
  google-oauth     oauth2     ✓ stored   (token expires in 23h)
  jira-oauth       oauth2     ✗ missing  → run: fam secret set jira-oauth
  gitlab-token     api_key    ✓ stored
```

---

### 10.6 Audit Log Schema

**Decision: SQLite at `~/.fam/audit.db`.**

```sql
CREATE TABLE mcp_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  profile TEXT NOT NULL,
  server_namespace TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_params_hash TEXT,
  response_status TEXT NOT NULL,      -- 'success' | 'error' | 'timeout' | 'denied'
  response_time_ms INTEGER,
  error_message TEXT
);

CREATE TABLE config_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,               -- 'apply' | 'secret_set' | 'register' | etc.
  target TEXT NOT NULL,
  details TEXT
);

CREATE INDEX idx_calls_ts ON mcp_calls(timestamp);
CREATE INDEX idx_calls_profile ON mcp_calls(profile);
CREATE INDEX idx_changes_ts ON config_changes(timestamp);
```

Note: `request_params_hash` not raw params — never log actual request content, which could contain sensitive data. Hash for correlation only.

---

### 10.7 Daemon Startup Sequence

```
fam daemon start
│
├─ 1. Load + validate fam.yaml (exit on invalid)
├─ 2. Load state.json (warn if missing, proceed)
├─ 3. Open/create audit.db, run migrations
├─ 4. Verify credentials in keychain (warn on missing, don't fail)
├─ 5. Spawn stdio MCP servers → call tools/list on each
├─ 6. Connect to HTTP/SSE MCP servers → call tools/list on each
├─ 7. Build unified tool registry (namespace prefixes + native tools)
├─ 8. Build per-profile filtered views
├─ 9. Load session tokens from sessions.json
├─ 10. Start Fastify on port + Unix socket
│     ├─ SSE: /mcp
│     ├─ Health: /health
│     └─ REST: /api/v1/* (optional)
└─ 11. Write PID file, log: "5 servers, 42 tools, 3 profiles ready"
```

**Graceful shutdown (SIGTERM/SIGINT):**

```
Stop accepting connections → drain in-flight calls (5s timeout)
→ SIGTERM stdio children (SIGKILL after 3s) → close SQLite → remove PID → exit 0
```

---

### 10.8 Error Handling Philosophy

**Degrade gracefully, never crash the daemon, always log.**

| Scenario | Behavior |
|---|---|
| Credential missing from keychain | Return MCP error to caller. Log warning. Other servers unaffected |
| Upstream server unreachable | Mark degraded. Retry every 60s. Other servers unaffected |
| Stdio process crashes | Auto-restart (max 3x in 60s, then mark degraded) |
| Invalid fam.yaml | `plan`/`apply` refuse. Running daemon keeps last valid config |
| Unknown/invalid token | Return MCP error "unauthorized." Log attempt |
| Tool outside caller's scope | Return "tool not found" (don't leak existence). Log as DENIED |
| Port already in use | Exit with clear message + suggestion |
| Keychain access denied by OS | Log with instructions for granting access |

---

### 10.9 MVP Build Order (for Claude Code)

```
Phase 1: Foundation (Day 1 morning)
├─ Project scaffold (package.json, tsconfig, eslint)
├─ fam.yaml Zod schema + parser
├─ CLI skeleton with commander
└─ Test: parse the sample YAML from this doc

Phase 2: Credential Vault (Day 1 afternoon)
├─ @napi-rs/keyring wrapper
├─ fam secret set/get/list/delete
├─ OAuth token storage (access + refresh + expiry)
└─ Test: store and retrieve from OS keychain

Phase 3: MCP Proxy Daemon (Day 1 evening → Day 2 morning)
├─ Fastify server with SSE MCP endpoint
├─ Stdio process pool (spawn, supervise, restart)
├─ HTTP/SSE upstream connection manager
├─ Tool discovery (tools/list aggregation + namespacing)
├─ Profile-based filtering
├─ Session token auth middleware
├─ Credential injection (keychain → upstream call)
├─ Native tools: whoami, log_action, list_servers, health
└─ Test: connect via MCP client, tools/list, call proxied tool

Phase 4: Config Generators + Plan/Apply (Day 2 afternoon)
├─ State file read/write
├─ Diff engine (YAML desired vs state.json current)
├─ fam plan with formatted output
├─ Generators: Claude Code, Cursor, VS Code, generic
├─ fam apply (write configs + state + register tokens)
├─ FAM.md instruction file generator
└─ Test: full cycle — init → secrets → plan → apply → verify

Phase 5: Audit + Polish (Day 2 evening)
├─ SQLite audit logger + middleware
├─ fam log with filters
├─ fam status + fam validate
├─ Daemon lifecycle (start/stop/restart + launchd/systemd)
├─ Error handling hardening
└─ Test: dogfood with real MCP servers

Phase 6: Ship (Day 3)
├─ README with hero example
├─ MIT LICENSE
├─ npm publish
├─ Homebrew formula
└─ Dogfood with EED Buddy + SPT configs
```
