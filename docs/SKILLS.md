# FAM Skills Reference -- AI-Consumable Configuration Guide

> **Purpose:** This document enables any AI assistant to reliably generate, validate, and troubleshoot FAM (FoFo Agent Manager) configurations. Treat this as the authoritative reference for config authoring.

> **What is FAM?** A local-first CLI + daemon that manages all your AI agent tools from a single YAML file (`fam.yaml`). It generates tool-specific configs for 17+ AI agents, proxies MCP traffic through a single endpoint, stores credentials in the OS keychain, and logs every call.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [fam.yaml Full Schema](#famyaml-full-schema)
3. [Config Sections In Depth](#config-sections-in-depth)
4. [CLI Command Reference](#cli-command-reference)
5. [Supported Agents & Generators](#supported-agents--generators)
6. [OAuth2 Providers](#oauth2-providers)
7. [Native Tools (Daemon API)](#native-tools-daemon-api)
8. [Common Config Patterns](#common-config-patterns)
9. [Validation Rules & Common Errors](#validation-rules--common-errors)
10. [Troubleshooting Playbook](#troubleshooting-playbook)

---

## Architecture Overview

```
fam.yaml (user writes this -- single source of truth)
    |
    v
fam plan / fam apply (CLI)
    |
    +--> generates tool-specific configs (Claude Code, Cursor, VS Code, Aider, etc.)
    +--> stores credentials in OS keychain (never in files)
    +--> starts local MCP proxy daemon on localhost:7865
    |
    v
AI tools connect to localhost:7865 as ONE MCP server
    |
    v
FAM proxies calls to real upstream servers, injects credentials,
enforces per-tool access scoping, and logs everything to SQLite
```

**Key principle:** AI tools don't know FAM exists. They see one MCP server and discover only the tools they're allowed to use.

**File locations:**
- Config: `./fam.yaml` or `~/.fam/fam.yaml`
- State: `~/.fam/state.json`
- Sessions: `~/.fam/sessions.json`
- Audit DB: `~/.fam/audit.db`
- Generated configs: per-generator `output` path
- Instructions: `~/.fam/instructions/`

---

## fam.yaml Full Schema

Below is the complete schema with every field, its type, whether it's required, and its default value.

```yaml
# ============================================================
# fam.yaml -- FoFo Agent Manager Configuration
# ============================================================

version: "0.1"                  # REQUIRED. Config schema version. Currently "0.1".

# ─── Global Settings ────────────────────────────────────────
settings:                       # Optional. Defaults shown below.
  daemon:
    port: 7865                  # int. Daemon listen port.
    socket: ~/.fam/agent.sock   # string. Unix socket path (supports ~).
    auto_start: true            # bool. Auto-start daemon on apply.
  audit:
    enabled: true               # bool. Enable audit logging.
    retention_days: 90          # int (positive). Days to retain logs.
    export_format: json         # "json" | "csv".
  sync:                         # Optional. Multi-machine sync (future).
    enabled: false              # bool.
    method: git                 # "git" only.

# ─── Credentials ────────────────────────────────────────────
# Declares what credentials exist. Actual values stored in OS keychain.
# Use `fam secret set <name>` to store the actual value.
credentials:                    # Optional. Record<string, Credential>.
  <credential-name>:
    # --- API Key type ---
    type: api_key               # REQUIRED. Literal "api_key".
    description: "..."          # REQUIRED. Human-readable description.
    env_var: ENV_VAR_NAME       # Optional. Environment variable name hint.
    rotate_after_days: 90       # Optional. int (positive). Rotation reminder.

    # --- OR OAuth2 type ---
    type: oauth2                # REQUIRED. Literal "oauth2".
    description: "..."          # REQUIRED.
    provider: google            # REQUIRED. See "OAuth2 Providers" section.
    client_id: "..."            # REQUIRED. Supports ${ENV_VAR} interpolation.
    scopes:                     # REQUIRED. List of OAuth scope strings.
      - https://...
    authorize_url: "..."        # Required ONLY when provider is "custom".
    token_url: "..."            # Required ONLY when provider is "custom".

# ─── Model Providers ───────────────────────────────────────
models:                         # Optional. Record<string, ModelProvider>.
  <provider-name>:
    provider: anthropic         # REQUIRED. "anthropic" | "openai" | "openai_compatible"
                                #           | "google" | "amazon_bedrock"
    credential: anthropic-key   # REQUIRED (nullable). Credential name or null.
    base_url: https://...       # Optional. Custom API endpoint URL.
    models:                     # REQUIRED. Record<alias, actual-model-id>.
      sonnet: claude-sonnet-4-20250514
      opus: claude-opus-4-20250514

# ─── MCP Servers ────────────────────────────────────────────
# Upstream MCP servers that FAM proxies to agents.
mcp_servers:                    # Optional. Record<string, McpServer>.

  # --- HTTP transport (SSE or Streamable HTTP) ---
  <server-name>:
    url: https://...            # REQUIRED. Valid URL.
    transport: sse              # REQUIRED. "sse" | "streamable_http"
    credential: github-pat      # REQUIRED (nullable). Credential name or null.
    description: "..."          # REQUIRED.
    headers:                    # Optional. Record<string, string>. Extra HTTP headers.
      X-Custom: value

  # --- Stdio transport (local process) ---
  <server-name>:
    command: npx                # REQUIRED. Executable name.
    args:                       # Optional. List of string args. Default: [].
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "/path/to/dir"
    transport: stdio            # REQUIRED. Literal "stdio".
    credential: null            # Optional (nullable). For env var injection.
    description: "..."          # REQUIRED.
    env:                        # Optional. Record<string, string>. Env vars for process.
      KEY: value

# ─── Agent Profiles ─────────────────────────────────────────
# Each profile = one AI agent/tool. Defines what it can access.
profiles:                       # REQUIRED. Record<string, Profile>.
  <profile-name>:
    description: "..."          # REQUIRED. Human-readable.
    config_target: claude_code  # REQUIRED. Generator name (see generators section).
    model: anthropic/sonnet     # Optional. "provider/alias" format.
    model_roles:                # Optional. Record<role-name, "provider/alias">.
      sonnet_tier: anthropic/sonnet
      opus_tier: anthropic/opus
    allowed_servers:            # REQUIRED. List of server names from mcp_servers.
      - github
      - filesystem
    denied_servers:             # Optional. List of server names. Default: [].
      - jira
    env_inject:                 # Optional. Record<string, string>.
      API_KEY: credential:anthropic-key   # "credential:<name>" resolves from keychain.
      LITERAL_VAR: some-value             # Plain string = literal value.
    max_tools: 40               # Optional. int (positive). Tool count limit.

# ─── Config Generators ──────────────────────────────────────
# Maps config_target names to output files and formats.
generators:                     # Optional. Record<string, Generator>.
  <generator-name>:
    output: ~/.claude.json  # REQUIRED. Output path (supports ~).
    format: claude_mcp_config        # REQUIRED. Generator format name.

# ─── Native Tools ───────────────────────────────────────────
# FAM's built-in tools exposed to agents via the daemon.
native_tools:                   # Optional. Record<string, NativeTool>.
  <tool-name>:
    enabled: true               # bool. Default: true.
    description: "..."          # REQUIRED.

# ─── Instruction File Generation ────────────────────────────
instructions:                   # Optional.
  enabled: true                 # bool. Default: true.
  output_dir: ~/.fam/instructions/  # string. Default: ~/.fam/instructions/.
  per_profile:                  # Optional. Record<profile-name, PerProfileInstruction>.
    <profile-name>:
      extra_context: |          # Optional. Additional markdown/text context.
        You are the Paperclip CEO agent.
        Use n8n workflows for automation.
      inject_into: AGENTS.md    # Optional. Filename to inject instructions into.
```

---

## Config Sections In Depth

### Credentials

FAM uses a **declare-then-store** pattern:
1. **Declare** the credential in `fam.yaml` (name, type, description)
2. **Store** the actual secret value via `fam secret set <name>` (goes to OS keychain)
3. **Reference** it from servers, profiles, or env_inject using the credential name

**API key credentials** are simple key-value secrets (tokens, PATs, API keys).

**OAuth2 credentials** trigger a browser-based auth flow via `fam auth login <name>`. FAM stores access tokens, refresh tokens, and expiry timestamps in the keychain automatically.

### Models

Models use a **provider + alias** system:
1. Define a provider with its credential, optional base_url, and a map of aliases to model IDs
2. Reference from profiles as `provider/alias` (e.g., `anthropic/sonnet`)

**Role names vary by agent:**

| Agent | Role Names |
|---|---|
| Claude Code | `sonnet_tier`, `opus_tier`, `haiku_tier` |
| Continue.dev | `chat`, `edit`, `apply`, `autocomplete`, `embed` |
| Aider | `editor`, `weak` |
| OpenCode | `coder`, `task` |
| OpenClaw | `fallback`, `economy` |

### MCP Servers

Every server declared in `mcp_servers` becomes available to profiles that list it in `allowed_servers`. FAM proxies all MCP traffic through a single daemon endpoint, namespacing tools by server name.

**Transport types:**
- `sse` -- Server-Sent Events (most common for remote MCP servers)
- `streamable_http` -- HTTP-based streamable transport
- `stdio` -- Local process (FAM spawns and manages the process)

### Profiles

Each profile represents one AI agent. The `config_target` field links it to a generator that knows how to write the agent's native config format.

**`env_inject` syntax:**
- `credential:<name>` -- Resolves to the actual credential value from keychain at apply time
- Any other string -- Used as a literal value

### Generators

Generators transform the abstract profile definition into the agent's native config format. Each generator knows the exact JSON/YAML/TOML structure the target agent expects.

**The generator `format` field must be one of the supported format names** (see table in "Supported Agents" section).

### Environment Variable Interpolation

Any string value in `fam.yaml` can use `${ENV_VAR}` syntax. Variables are resolved during config parsing, before schema validation. Unset variables are left as literal `${VAR_NAME}` strings.

---

## CLI Command Reference

### Project Lifecycle

```bash
fam init [--dir <path>] [--force]
```
Interactive setup. Creates `fam.yaml`, auto-discovers existing MCP configs from installed AI tools, scaffolds `~/.fam/` directory.

```bash
fam plan
```
Preview changes without applying. Shows colored diff (adds/changes/removes). Exit code 0 = no changes, 2 = changes pending.

```bash
fam apply [--yes] [--dry-run]
```
Apply the declared configuration. Generates all configs, stores credentials, creates session tokens, starts daemon if configured. `--yes` skips confirmation, `--dry-run` shows what would happen.

```bash
fam validate
```
Pre-apply validation. Checks schema, credential existence, writable paths, tool limits, cross-references. Exit 0 = pass, 1 = fail.

```bash
fam status
```
Quick health overview: daemon status, config validity, credential count, server count, profile count.

### Credential Management

```bash
fam secret set <name>
```
Store a credential in OS keychain. Prompts for value with hidden input.

```bash
fam secret get <name> [--yes]
```
Check if credential exists and show masked preview. `--yes` required for display (safety for shared terminals). FAM never exposes full values -- use OS keychain tools for that.

```bash
fam secret list
```
List all declared credentials with keychain status and rotation countdown.

```bash
fam secret delete <name> [--yes]
```
Remove credential from keychain. `--yes` skips confirmation.

### MCP Server Management

```bash
fam mcp add <name> --transport <sse|streamable_http|stdio> [options]
```
Add an MCP server to `fam.yaml`.
- HTTP: `--url <url>` required
- Stdio: `--command <cmd>` required, `--args <args...>` optional
- Common: `--credential <name>`, `--description <desc>`

```bash
fam mcp remove <name>
```
Remove an MCP server. Warns if profiles reference it.

```bash
fam mcp list
```
List configured servers in a formatted table.

### Config Management

```bash
fam config manage <profile>
```
Re-trigger merge strategy for a profile's config file. Options:
- **Import & Manage** -- Backup existing, let FAM control
- **Overwrite** -- Backup existing, replace entirely
- **Skip** -- Leave alone (manual management)

### Session Token Management

```bash
fam register <profile>
```
Generate a new session token for a profile. Token displayed once, never retrievable again. Format: `fam_sk_<prefix>_<64-hex-chars>`

```bash
fam register <profile> --rotate
```
Replace existing token with a new one.

```bash
fam register <profile> --revoke
```
Delete the token. Profile loses daemon authentication.

### Daemon Lifecycle

```bash
fam daemon start [--foreground]
fam daemon stop
fam daemon restart [--foreground]
fam daemon status
```
Manage the MCP proxy daemon. `--foreground` keeps it attached with stdout logging.

```bash
fam daemon install
```
Install auto-start (macOS: launchd plist, Linux: systemd user unit).

```bash
fam daemon uninstall
```
Remove auto-start configuration.

### OAuth2 Authentication

```bash
fam auth login <credential>
```
Start browser-based OAuth2 flow. Credential must be type `oauth2`.

```bash
fam auth status [credential]
```
Show token status for all or specific OAuth2 credentials.

```bash
fam auth refresh <credential>
```
Force-refresh an OAuth2 access token.

```bash
fam auth providers
```
List supported OAuth2 providers.

### Audit Log

```bash
fam log [--profile <name>] [--server <ns>] [--since <1h|24h|7d|30d>] [--limit <n>] [--status <success|error|denied|timeout>]
```
Query the audit log with optional filters.

```bash
fam log export [--format <json|csv>] [--since <duration>] [--output <path>] [--profile <name>] [--server <ns>]
```
Export audit log to file or stdout.

### Knowledge Store

```bash
fam knowledge set <key> <value> [--namespace <ns>] [--tags <a,b,c>]
fam knowledge get <key> [--namespace <ns>]
fam knowledge search <query> [--namespace <ns>] [--limit <n>]
fam knowledge list [--namespace <ns>] [--limit <n>]
fam knowledge delete <key> [--namespace <ns>]
```
Manage a shared key-value knowledge store accessible to all agents via native tools.

### Drift Detection

```bash
fam drift [--json] [--watch]
```
Compare generated configs against expected state. Detects unauthorized modifications. Exit code 2 = drift detected. `--watch` polls every 5 seconds.

### Global Flags (available on all commands)

```
--config <path>       Path to fam.yaml
--fam-dir <path>      Path to FAM data directory (default: ~/.fam)
-v, --verbose         Verbose output
--json                JSON output for scripting
--no-color            Disable color output
```

---

## Supported Agents & Generators

| Agent | Format Name | Default Output Path | File Format |
|---|---|---|---|
| Claude Code | `claude_mcp_config` | `~/.claude.json` (+ `~/.claude/settings.json` for env)¹ | JSON |
| Cursor | `cursor_mcp_config` | `~/.cursor/mcp.json` | JSON |
| VS Code | `vscode_mcp_config` | `.vscode/mcp.json` | JSON |
| Windsurf | `windsurf_mcp_config` | `~/.codeium/windsurf/mcp_config.json` | JSON |
| Zed | `zed_config` | `~/.config/zed/settings.json` | JSON |
| Cline | `cline_mcp_config` | `cline_mcp_settings.json` | JSON |
| Roo Code | `roo_code_mcp_config` | `.roo/mcp.json` | JSON |
| OpenCode | `opencode_config` | `~/.config/opencode/opencode.json` | JSON |
| OpenHands | `openhands_config` | `~/.openhands/config.toml` | JSON |
| Gemini CLI | `gemini_mcp_config` | `~/.gemini/settings.json` | JSON |
| GitHub Copilot | `github_copilot_mcp_config` | `~/.copilot/mcp-config.json` | JSON |
| Amazon Q | `amazon_q_config` | `~/.aws/amazonq/agents/default.json` | JSON |
| Aider | `aider_config` | `~/.aider.conf.yml` | YAML |
| Continue.dev | `continue_config` | `~/.continue/config.yaml` | YAML |
| OpenClaw | `openclaw_config` | `~/.openclaw/openclaw.json` | JSON |
| NemoClaw | `nemoclaw_config` | `~/.nemoclaw/openclaw.json` | JSON |
| Generic | `generic_mcp_list` | `~/.fam/configs/${profile_name}.json` | JSON |

**Important:** The `config_target` in a profile must match a key in the `generators` section, and the generator's `format` must be one of the format names above.

¹ Claude Code 2.x reads MCP config from `~/.claude.json` (top-level `mcpServers`, `type: "http"`) and reads env vars from `~/.claude/settings.json`. FAM writes both files automatically — the settings.json file is emitted as a secondary output via the generator's `additionalFiles` mechanism and is always merged with `import_and_manage` (deep merge, FAM keys win) to preserve any user-added keys.

---

## OAuth2 Providers

### Built-in Providers

| Provider Key | Service | Authorize URL | Token URL |
|---|---|---|---|
| `github` | GitHub | `https://github.com/login/oauth/authorize` | `https://github.com/login/oauth/access_token` |
| `gitlab` | GitLab | `https://gitlab.com/oauth/authorize` | `https://gitlab.com/oauth/token` |
| `bitbucket` | Bitbucket | `https://bitbucket.org/site/oauth2/authorize` | `https://bitbucket.org/site/oauth2/access_token` |
| `google` | Google | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` |
| `microsoft` | Microsoft | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| `atlassian` | Jira/Confluence | `https://auth.atlassian.com/authorize` | `https://auth.atlassian.com/oauth/token` |
| `notion` | Notion | `https://api.notion.com/v1/oauth/authorize` | `https://api.notion.com/v1/oauth/token` |
| `linear` | Linear | `https://linear.app/oauth/authorize` | `https://api.linear.app/oauth/token` |
| `slack` | Slack | `https://slack.com/oauth/v2/authorize` | `https://slack.com/api/oauth.v2.access` |
| `discord` | Discord | `https://discord.com/oauth2/authorize` | `https://discord.com/api/oauth2/token` |
| `figma` | Figma | `https://www.figma.com/oauth` | `https://api.figma.com/v1/oauth/token` |
| `okta` | Okta | `https://{domain}.okta.com/oauth2/default/v1/authorize` | `https://{domain}.okta.com/oauth2/default/v1/token` |
| `auth0` | Auth0 | `https://{domain}.auth0.com/authorize` | `https://{domain}.auth0.com/oauth/token` |
| `aws_cognito` | AWS Cognito | `https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize` | `https://{domain}.auth.{region}.amazoncognito.com/oauth2/token` |

### Custom Provider

For any OAuth2-compliant provider not listed above:

```yaml
credentials:
  my-custom-oauth:
    type: oauth2
    description: "My Custom SSO"
    provider: custom
    client_id: ${MY_CLIENT_ID}
    scopes:
      - openid
      - profile
    authorize_url: https://sso.example.com/oauth/authorize
    token_url: https://sso.example.com/oauth/token
```

**Rule:** When `provider: custom`, both `authorize_url` and `token_url` are REQUIRED.

---

## Native Tools (Daemon API)

These tools are exposed to agents through the FAM MCP proxy. All are prefixed with `fam__`.

| Tool | Input | Returns |
|---|---|---|
| `fam__whoami` | (none) | Profile name, allowed/denied servers, tool count, native tools list |
| `fam__log_action` | `{ action: string, description: string, metadata?: object }` | `{ logged: true }` |
| `fam__list_servers` | (none) | Array of `{ name, status, tool_count, last_reachable }` |
| `fam__health` | (none) | Daemon status, version, uptime, per-server status |
| `fam__get_knowledge` | `{ key: string, namespace?: string }` | Knowledge entry or `{ found: false }` |
| `fam__set_knowledge` | `{ key: string, value: string, namespace?: string, tags?: string[] }` | `{ stored: true, key }` |
| `fam__search_knowledge` | `{ query: string, namespace?: string, limit?: number }` | Search results array |
| `fam__get_audit_log` | `{ profile?: string, server?: string, limit?: number, since?: string }` | `{ entries: [], count }` |
| `fam__list_profiles` | (none) | Array of `{ name, description, allowed_servers, denied_servers }` |

---

## Common Config Patterns

### Pattern 1: Minimal Setup (one agent, one server)

```yaml
version: "0.1"

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    transport: stdio
    description: "Local filesystem access"

profiles:
  claude-code:
    description: "Claude Code"
    config_target: claude_code
    allowed_servers:
      - filesystem

generators:
  claude_code:
    output: ~/.claude.json
    format: claude_mcp_config
```

### Pattern 2: Multiple Agents Sharing Servers

```yaml
version: "0.1"

credentials:
  github-pat:
    type: api_key
    description: "GitHub Personal Access Token"
  anthropic-key:
    type: api_key
    description: "Anthropic API Key"

models:
  anthropic:
    provider: anthropic
    credential: anthropic-key
    models:
      sonnet: claude-sonnet-4-20250514
      opus: claude-opus-4-20250514
      haiku: claude-haiku-4-5-20251001

mcp_servers:
  github:
    url: https://api.githubcopilot.com/mcp/
    transport: sse
    credential: github-pat
    description: "GitHub repos, issues, PRs"
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    transport: stdio
    description: "Local filesystem"

profiles:
  claude-code:
    description: "Claude Code -- primary agent"
    config_target: claude_code
    model: anthropic/sonnet
    model_roles:
      sonnet_tier: anthropic/sonnet
      opus_tier: anthropic/opus
      haiku_tier: anthropic/haiku
    allowed_servers: [github, filesystem]
    env_inject:
      ANTHROPIC_API_KEY: credential:anthropic-key

  cursor:
    description: "Cursor IDE"
    config_target: cursor
    allowed_servers: [github, filesystem]
    max_tools: 35

  vscode:
    description: "VS Code with Copilot"
    config_target: vscode
    allowed_servers: [github, filesystem]

generators:
  claude_code:
    output: ~/.claude.json
    format: claude_mcp_config
  cursor:
    output: ~/.cursor/mcp.json
    format: cursor_mcp_config
  vscode:
    output: .vscode/mcp.json
    format: vscode_mcp_config
```

### Pattern 3: OAuth2 with Google and Jira

```yaml
version: "0.1"

credentials:
  google-oauth:
    type: oauth2
    description: "Google Workspace"
    provider: google
    client_id: ${GOOGLE_CLIENT_ID}
    scopes:
      - https://www.googleapis.com/auth/drive.readonly
      - https://www.googleapis.com/auth/calendar.readonly

  jira-oauth:
    type: oauth2
    description: "Jira Cloud"
    provider: atlassian
    client_id: ${JIRA_CLIENT_ID}
    scopes:
      - read:jira-work
      - write:jira-work

mcp_servers:
  google-drive:
    url: https://gdrive.mcp.claude.com/mcp
    transport: streamable_http
    credential: google-oauth
    description: "Google Drive access"

  jira:
    url: https://mcp.atlassian.com/v1/sse
    transport: sse
    credential: jira-oauth
    description: "Jira issue tracking"

profiles:
  claude-code:
    description: "Claude Code with productivity tools"
    config_target: claude_code
    allowed_servers: [google-drive, jira]

generators:
  claude_code:
    output: ~/.claude.json
    format: claude_mcp_config
```

Then run:
```bash
fam auth login google-oauth    # Opens browser for Google consent
fam auth login jira-oauth      # Opens browser for Jira consent
fam apply
```

### Pattern 4: Local LLM with OpenAI-Compatible Proxy

```yaml
version: "0.1"

models:
  local:
    provider: openai_compatible
    credential: null
    base_url: http://localhost:11434/v1
    models:
      llama: llama-3.3-70b
      mistral: mistral-7b

profiles:
  opencode:
    description: "OpenCode with local models"
    config_target: opencode
    model: local/llama
    model_roles:
      coder: local/llama
      task: local/mistral
    allowed_servers: []

generators:
  opencode:
    output: ~/.config/opencode/opencode.json
    format: opencode_config
```

### Pattern 5: Scoped Access -- Restricted Automation Agent

```yaml
version: "0.1"

mcp_servers:
  n8n:
    url: http://localhost:5678/mcp
    transport: sse
    credential: null
    description: "n8n workflow engine"
  github:
    url: https://api.githubcopilot.com/mcp/
    transport: sse
    credential: github-pat
    description: "GitHub"

profiles:
  # This agent can ONLY access n8n, explicitly denied from github
  automation-bot:
    description: "Automation agent -- n8n only"
    config_target: generic
    allowed_servers:
      - n8n
    denied_servers:
      - github

generators:
  generic:
    output: ~/.fam/configs/${profile_name}.json
    format: generic_mcp_list
```

### Pattern 6: Full Kitchen Sink (all features)

```yaml
version: "0.1"

settings:
  daemon:
    port: 7865
    socket: ~/.fam/agent.sock
    auto_start: true
  audit:
    enabled: true
    retention_days: 90
    export_format: json

credentials:
  github-pat:
    type: api_key
    description: "GitHub Personal Access Token"
    env_var: GITHUB_TOKEN
    rotate_after_days: 90
  anthropic-key:
    type: api_key
    description: "Anthropic API Key"
    env_var: ANTHROPIC_API_KEY
  google-oauth:
    type: oauth2
    description: "Google Workspace OAuth"
    provider: google
    client_id: ${GOOGLE_CLIENT_ID}
    scopes:
      - https://www.googleapis.com/auth/drive.readonly
      - https://www.googleapis.com/auth/calendar.readonly

models:
  anthropic:
    provider: anthropic
    credential: anthropic-key
    models:
      sonnet: claude-sonnet-4-20250514
      opus: claude-opus-4-20250514
      haiku: claude-haiku-4-5-20251001

mcp_servers:
  github:
    url: https://api.githubcopilot.com/mcp/
    transport: sse
    credential: github-pat
    description: "GitHub repos, issues, PRs"
  google-drive:
    url: https://gdrive.mcp.claude.com/mcp
    transport: streamable_http
    credential: google-oauth
    description: "Google Drive access"
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    transport: stdio
    description: "Local filesystem access"
  n8n:
    url: http://localhost:5678/mcp
    transport: sse
    credential: null
    description: "Local n8n workflow engine"

profiles:
  claude-code:
    description: "Claude Code -- primary coding agent"
    config_target: claude_code
    model: anthropic/sonnet
    model_roles:
      sonnet_tier: anthropic/sonnet
      opus_tier: anthropic/opus
      haiku_tier: anthropic/haiku
    allowed_servers: [github, filesystem, n8n]
    denied_servers: []
    env_inject:
      ANTHROPIC_API_KEY: credential:anthropic-key

  cursor:
    description: "Cursor IDE"
    config_target: cursor
    allowed_servers: [github, google-drive, filesystem]
    max_tools: 35

  paperclip:
    description: "Paperclip CEO -- automation agent"
    config_target: generic
    allowed_servers: [n8n]
    denied_servers: [github]

generators:
  claude_code:
    output: ~/.claude.json
    format: claude_mcp_config
  cursor:
    output: ~/.cursor/mcp.json
    format: cursor_mcp_config
  generic:
    output: ~/.fam/configs/${profile_name}.json
    format: generic_mcp_list

native_tools:
  log_action:
    enabled: true
    description: "Log actions for audit trail"
  whoami:
    enabled: true
    description: "Returns caller's profile and permissions"
  list_servers:
    enabled: true
    description: "List available servers for caller"
  health:
    enabled: true
    description: "Daemon and server reachability status"

instructions:
  enabled: true
  output_dir: ~/.fam/instructions/
  per_profile:
    paperclip:
      extra_context: |
        You are the Paperclip CEO agent.
        Use n8n workflows for image generation and fulfillment.
        Log all significant actions via fam.log_action.
    claude-code:
      inject_into: AGENTS.md
      extra_context: |
        You are working on Stanford EED and SPT projects.
        Use GitLab for Stanford repos, GitHub for SPT repos.
```

---

## Validation Rules & Common Errors

### Schema Validation (Zod)

| Rule | Error If Violated |
|---|---|
| `version` must be present | `"version" is required` |
| `profiles` must be present | `"profiles" is required` |
| MCP server URL must be valid | `Invalid url` |
| Transport must be `sse`, `streamable_http`, or `stdio` | `Invalid enum value` |
| `rotate_after_days` must be positive int | `Number must be greater than 0` |
| `max_tools` must be positive int | `Number must be greater than 0` |
| OAuth2 `custom` provider requires `authorize_url` and `token_url` | Custom provider validation error |
| Credential `type` must be `api_key` or `oauth2` | `Invalid discriminator value` |
| Model `provider` must be one of the supported enums | `Invalid enum value` |

### Cross-Field Validation (superRefine)

| Rule | Error If Violated |
|---|---|
| Profile `allowed_servers` references unknown server name | `Profiles reference unknown server` |
| Model provider `credential` references unknown credential | `Model provider credential not found` |
| Profile `model` references unknown provider or alias | `Profile references unknown model provider/alias` |
| Profile `model_roles` reference unknown provider or alias | `Profile model_roles reference unknown provider/alias` |

### Pre-Apply Validation (`fam validate`)

| Check | Result |
|---|---|
| Config schema valid | PASS/FAIL |
| All credentials exist in keychain | PASS/WARN (missing = WARN) |
| Output paths writable | PASS/FAIL |
| Tool count within limits (e.g., Cursor 40-tool max) | PASS/WARN |
| Profile config_target maps to generator | PASS/FAIL |
| Server credential references exist | PASS/WARN |

---

## Troubleshooting Playbook

### "Config file not found"

```
Error: CONFIG_FILE_NOT_FOUND
```

**Fix:** FAM looks for config in this order:
1. `--config <path>` flag
2. `./fam.yaml` in current directory
3. `~/.fam/fam.yaml`

Run `fam init` to create one, or specify `--config /path/to/fam.yaml`.

### "Profiles reference unknown server"

```
Error: CONFIG_VALIDATION_ERROR -- Profiles reference unknown server
```

**Fix:** Every name in `allowed_servers` and `denied_servers` must exist as a key in `mcp_servers`. Check for typos.

```yaml
# WRONG -- "git-hub" doesn't match "github"
mcp_servers:
  github: { ... }
profiles:
  my-agent:
    allowed_servers: [git-hub]  # Typo!

# CORRECT
profiles:
  my-agent:
    allowed_servers: [github]
```

### "Credential not found in keychain"

```
WARN: Credential "github-pat" not found in keychain
```

**Fix:** Run `fam secret set github-pat` and enter the value when prompted.

For OAuth2 credentials: Run `fam auth login <credential-name>` to start the browser flow.

### "Profile references unknown model provider"

```
Error: Profile references unknown model provider "anthropic"
```

**Fix:** The `model` field uses `provider/alias` format. Make sure:
1. The provider name matches a key in the `models` section
2. The alias matches a key in that provider's `models` map

```yaml
# WRONG
profiles:
  claude-code:
    model: sonnet              # Missing provider prefix!

# CORRECT
profiles:
  claude-code:
    model: anthropic/sonnet    # "provider/alias" format
```

### Daemon won't start / port in use

```bash
# Check what's using port 7865
lsof -i :7865

# Stop existing daemon
fam daemon stop

# Or use a different port
# In fam.yaml:
settings:
  daemon:
    port: 8080
```

### Drift detected

```bash
fam drift
# Output: claude_code: MODIFIED (expected abc123, got def456)
```

**Fix:** Someone (or another tool) modified the generated config file. Options:
1. `fam apply` -- Regenerate and overwrite
2. `fam config manage <profile>` -- Choose merge strategy
3. Manually edit `fam.yaml` to match desired state, then `fam apply`

### OAuth2 token expired

```bash
fam auth status google-oauth
# Shows: access_token: EXPIRED
```

**Fix:**
```bash
fam auth refresh google-oauth   # Auto-refresh using stored refresh token
# OR
fam auth login google-oauth     # Full re-authorization if refresh fails
```

### Session token lost

Session tokens are displayed once during `fam apply` or `fam register`. They cannot be retrieved.

**Fix:**
```bash
fam register <profile> --rotate   # Generate a new token
fam apply                         # Regenerate configs with new token
```

### Generated config looks wrong

```bash
# Check what FAM thinks the state is
fam plan

# Validate config first
fam validate

# Re-apply to regenerate
fam apply --yes
```

### Agent can't connect to daemon

1. Check daemon is running: `fam daemon status`
2. Check port matches: verify `settings.daemon.port` in `fam.yaml`
3. Check the generated config has correct URL and token
4. Check agent's allowed_servers aren't empty

### Environment variable not resolving

`${ENV_VAR}` stays as a literal string if the variable isn't set in the shell environment when running `fam apply`.

**Fix:** Export the variable before applying:
```bash
export GOOGLE_CLIENT_ID="your-client-id"
fam apply
```

---

## Quick Reference Card

```bash
# Setup
fam init                          # Interactive project setup
fam secret set <name>             # Store credential in keychain
fam auth login <name>             # OAuth2 browser flow

# Workflow (Terraform-style)
fam validate                      # Check config
fam plan                          # Preview changes
fam apply                         # Apply changes
fam drift                         # Check for unauthorized changes

# Daemon
fam daemon start                  # Start MCP proxy
fam daemon status                 # Check health
fam daemon stop                   # Stop proxy

# Inspection
fam status                        # Overall health
fam secret list                   # Credential status
fam mcp list                      # Server list
fam log --since 24h               # Recent audit log
fam auth status                   # OAuth2 token status
```
