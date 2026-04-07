# FAM User Guide

**FoFo Agent Manager -- One config. Every agent.**

FAM is a local-first CLI + daemon that manages all your AI agent tools from a single YAML file. Instead of editing five different config files every time you add an MCP server, you declare everything once in `fam.yaml` and FAM generates the right config for each tool, proxies all MCP traffic through a single endpoint, stores credentials in your OS keychain, and logs every call.

---

## How FAM Works

```
fam.yaml (you write this)
    |
    v
fam plan / fam apply (CLI)
    |
    +--> generates configs for each tool (Claude Code, Cursor, VS Code, OpenCode, ...)
    +--> stores credentials in OS keychain
    +--> starts a local MCP proxy daemon on localhost:7865
    |
    v
Your AI tools connect to localhost:7865 as a single MCP server
    |
    v
FAM proxies calls to the real upstream servers, injects credentials,
enforces per-tool access scoping, and logs everything
```

**Your tools don't know FAM exists.** They connect to one MCP server and discover their allowed tools. FAM is invisible middleware.

---

## Guides

| Guide | What It Covers |
|---|---|
| [Installation](./installation.md) | Install FAM from npm or build from source |
| [OpenCode Setup](./opencode-setup.md) | Connect OpenCode to FAM step by step |

---

## Quick Start

```bash
# Install
npm install -g @sweetpapatech/fam

# Create your config
fam init

# Add a credential
fam secret set github-pat

# See what will change
fam plan

# Apply configuration
fam apply

# Start the proxy daemon
fam daemon start --foreground
```

---

## Core Concepts

### fam.yaml

The single source of truth. Declares your credentials, MCP servers, tool profiles, and config generators. Everything else is derived from this file.

```yaml
version: "1.0"

credentials:
  github-pat:
    type: api_key
    description: "GitHub Personal Access Token"

  github-oauth:
    type: oauth2
    description: "GitHub OAuth2"
    provider: github
    client_id: "your-client-id"
    scopes: ["repo", "read:user"]

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
    description: "Local filesystem access"

profiles:
  claude-code:
    description: "Claude Code"
    config_target: claude_code
    allowed_servers: [github, filesystem]

generators:
  claude_code:
    output: ~/.claude/settings.json
    format: claude_mcp_config
```

### Profiles

A profile represents one AI tool. It defines which MCP servers that tool can access. When the tool connects to FAM, it only sees the tools it's allowed to use.

```yaml
profiles:
  claude-code:
    allowed_servers: [github, filesystem, n8n]
    denied_servers: [jira]    # Explicitly blocked

  cursor:
    allowed_servers: [github, jira, gitlab]

  paperclip:
    allowed_servers: [n8n]    # Only workflow access
```

### Credentials

Secrets live in your OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret). They're declared in `fam.yaml` but the actual values are never written to any file.

```bash
# Store a credential
fam secret set github-pat
# Enter value: ****

# Check what's stored
fam secret list
# github-pat    api_key    stored    (rotation in 75 days)
# jira-oauth    oauth2     missing   -> run: fam secret set jira-oauth
```

For OAuth2 credentials, use `fam auth login <name>` to start the browser-based authorization flow. FAM stores the tokens in your keychain and handles refresh automatically when they expire. Supported providers: GitHub, Google, Atlassian, Microsoft, GitLab, Slack.

### The Daemon

FAM runs a local proxy daemon on `localhost:7865`. Your tools connect to it as a standard MCP server. The daemon:

- Aggregates tools from all upstream MCP servers into one `tools/list`
- Prefixes tool names with their server namespace (`github__repos_list`)
- Injects credentials from the keychain just-in-time
- Enforces per-profile access control
- Logs every call to a local SQLite audit database

---

## CLI Reference

### Lifecycle Commands

| Command | Description |
|---|---|
| `fam init` | Create a new `fam.yaml` with interactive prompts |
| `fam plan` | Show what `apply` would change (like `terraform plan`) |
| `fam apply` | Apply the config: generate files, store credentials, create tokens |
| `fam apply --yes` | Skip confirmation prompt |
| `fam apply --dry-run` | Show what would happen without writing anything |
| `fam validate` | Check config for errors before applying |

### Daemon Commands

| Command | Description |
|---|---|
| `fam daemon start` | Start the MCP proxy daemon |
| `fam daemon start --foreground` | Start attached to terminal (logs visible) |
| `fam daemon stop` | Stop the running daemon |
| `fam daemon restart` | Stop then start |
| `fam daemon status` | Show running state, PID, uptime, connected servers |
| `fam daemon install` | Set up auto-start (launchd on macOS, systemd on Linux) |
| `fam daemon uninstall` | Remove auto-start configuration |

### Credential Commands

| Command | Description |
|---|---|
| `fam secret set <name>` | Store a credential in the OS keychain (hidden input) |
| `fam secret get <name> --yes` | Print a stored credential (requires `--yes` for safety) |
| `fam secret list` | Show all credentials and their status |
| `fam secret delete <name>` | Remove a credential from the keychain |

### OAuth2 Commands

| Command | Description |
|---|---|
| `fam auth login <credential>` | Start OAuth2 authorization flow (opens browser) |
| `fam auth status [credential]` | Show OAuth2 token status and expiry |
| `fam auth refresh <credential>` | Force-refresh an access token |
| `fam auth providers` | List supported OAuth2 providers |

### Token & Server Commands

| Command | Description |
|---|---|
| `fam register <profile>` | Generate a session token for a tool profile |
| `fam register --rotate <profile>` | Replace an existing token |
| `fam register --revoke <profile>` | Remove a profile's access |
| `fam mcp add <name> [options]` | Add an MCP server to `fam.yaml` |
| `fam mcp remove <name>` | Remove an MCP server |
| `fam mcp list` | List configured MCP servers |

**Adding an MCP server via CLI:**

```bash
# Add a stdio server (e.g., Playwright)
fam mcp add playwright \
  --transport stdio \
  --command npx \
  --args "@playwright/mcp@latest" \
  --description "Playwright browser automation"

# Add an HTTP/SSE server (e.g., GitHub)
fam mcp add github \
  --transport sse \
  --url https://api.githubcopilot.com/mcp/ \
  --credential github-pat \
  --description "GitHub repos, issues, PRs"

# Then add it to a profile's allowed_servers in fam.yaml and apply
fam plan
fam apply
```

### Knowledge Commands

| Command | Description |
|---|---|
| `fam knowledge set <key> <value>` | Store a knowledge entry |
| `fam knowledge get <key>` | Retrieve a knowledge entry |
| `fam knowledge search <query>` | Full-text search across entries |
| `fam knowledge list` | List all entries |
| `fam knowledge delete <key>` | Delete an entry |

Options: `--namespace <ns>` (scope entries), `--tags <t1,t2>` (categorize), `--limit <n>` (pagination).

### Monitoring Commands

| Command | Description |
|---|---|
| `fam status` | Quick health overview of everything |
| `fam log` | Show recent audit log entries |
| `fam log --profile claude-code` | Filter by profile |
| `fam log --since 24h` | Filter by time |
| `fam log export --format json` | Export audit log to JSON |
| `fam log export --format csv -o audit.csv` | Export to CSV file |

### Drift Detection

| Command | Description |
|---|---|
| `fam drift` | Check for config file drift since last `fam apply` |
| `fam drift --json` | Output drift report as JSON (CI-friendly) |
| `fam drift --watch` | Continuously monitor for drift (polls every 5s) |

Exits with code 2 when drift is detected, making it usable in CI pipelines.

### Global Options

| Option | Description |
|---|---|
| `--config <path>` | Path to fam.yaml (default: `./fam.yaml`, then `~/.fam/fam.yaml`) |
| `--fam-dir <path>` | Path to FAM data directory (default: `~/.fam`) |
| `-v, --verbose` | Verbose output |
| `--json` | JSON output for scripting |
| `--no-color` | Disable colored output |

---

## Supported Tools

FAM ships with config generators for these tools out of the box:

| Tool | Config Target | Generated File |
|---|---|---|
| Claude Code | `claude_code` | `~/.claude/settings.json` |
| Cursor | `cursor` | `~/.cursor/mcp.json` |
| VS Code (Copilot) | `vscode` | `.vscode/mcp.json` |
| OpenHands | `openhands` | `~/.openhands/config.toml` |
| OpenCode | `opencode` | `~/.config/opencode/opencode.json` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` |
| Zed | `zed` | `~/Library/Application Support/Zed/settings.json` |
| Cline | `cline` | `cline_mcp_settings.json` |
| Roo Code | `roo_code` | `.roo/mcp.json` |
| Gemini CLI | `gemini_cli` | `~/.gemini/settings.json` |
| GitHub Copilot | `github_copilot` | `~/.copilot/mcp-config.json` |
| Amazon Q | `amazon_q` | `~/.aws/amazonq/agents/default.json` |
| Any MCP client | `generic` | `~/.fam/configs/<profile>.json` |

Any tool that speaks MCP can connect to FAM. If your tool isn't listed above, use the `generic` config target and point it at `http://localhost:7865/mcp`.

---

## Native FAM Tools

When a tool connects to FAM, it sees these built-in tools alongside the proxied upstream tools:

| Tool | What It Does |
|---|---|
| `fam__whoami` | Returns the caller's profile name, allowed servers, and permissions |
| `fam__log_action` | Report a significant action for the audit trail |
| `fam__list_servers` | List available MCP servers and their status |
| `fam__health` | Check daemon health, server reachability, uptime |
| `fam__get_knowledge` | Retrieve a knowledge entry by key |
| `fam__set_knowledge` | Store a knowledge entry (upsert with full-text search) |
| `fam__search_knowledge` | Full-text search across knowledge entries |
| `fam__get_audit_log` | Query the audit trail with filters |
| `fam__list_profiles` | List all configured profiles with access details |

These tools help agents understand their environment, share knowledge, and report their actions.

---

## Files FAM Creates

| Path | What It Is |
|---|---|
| `fam.yaml` | Your config (you create and edit this) |
| `~/.fam/state.json` | Last-applied state (for computing diffs) |
| `~/.fam/sessions.json` | Session token hashes (one per tool profile) |
| `~/.fam/audit.db` | SQLite audit log (every proxied call) |
| `~/.fam/knowledge.db` | SQLite knowledge store (shared agent learnings) |
| `~/.fam/fam.pid` | Daemon process ID (when running) |
| `~/.fam/configs/` | Generated config files for tools |
| `~/.fam/instructions/` | Generated FAM.md instruction files per profile |

All files in `~/.fam/` are created with restricted permissions (owner-only).

---

## Security

- Credentials are stored in your OS keychain, never in config files or logs
- Session tokens are shown once at generation, then only stored as SHA-256 hashes
- The daemon binds to `localhost` only -- no remote access
- Per-profile scoping controls which tools see which MCP servers
- Denied tools return "not found" (not "access denied") to prevent information leakage
- All sensitive files are written with `0600` permissions (owner read/write only)
- The audit log records every proxied call but never logs request bodies or credential values
- Token comparison uses constant-time operations to prevent timing attacks
- Request body size is capped at 1MB, with per-profile rate limiting (200 req/min)

---

## Getting Help

```bash
fam --help                # All commands
fam <command> --help      # Help for a specific command
fam status                # Quick health check
fam log --since 1h        # Recent activity
```

For bugs and feature requests: [github.com/sweetpapatech/fam/issues](https://github.com/sweetpapatech/fam/issues)
