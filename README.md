# FAM -- FoFo Agent Manager

> One config. Every agent.

> [!CAUTION]
> **FAM is in early alpha.** APIs, config format, and CLI commands may change without notice. Some features are implemented but not yet tested end-to-end. We're actively building and breaking things. Use at your own risk, and please [report issues](https://github.com/Sweet-Papa-Technologies/FAM/issues) -- your feedback shapes the project.

A local-first CLI + daemon that acts as the universal source of truth for AI agent configuration, credentials, and lifecycle management.

## Quick Start

```bash
# Install from local clone (not on npm yet)
git clone https://github.com/Sweet-Papa-Technologies/FAM.git && cd FAM
npm install && npm run build
npm link        # or: npm install -g .

# Create your config
fam init

# Review what will change
fam plan

# Apply configuration
fam apply

# Start the MCP proxy daemon
fam daemon start
```

No root/sudo required. See [installation docs](docs/user/installation.md) for all options.

## Features

- **Single YAML config** -- generates tool-specific configs for 17 AI agents from one `fam.yaml`
- **LLM model management** -- define providers and models centrally, assign to agents with role-based config (coder/editor/fast/powerful)
- **MCP proxy daemon** -- one endpoint (`localhost:7865`) proxies all MCP servers with per-tool scoping and namespace isolation
- **OS keychain vault** -- credentials stored in macOS Keychain / GNOME Keyring / Windows Credential Manager, injected at runtime, never in config files
- **Terraform-style workflow** -- `fam plan` shows a diff, `fam apply` makes it happen
- **Per-agent access control** -- each agent only sees the MCP servers it's allowed to use
- **Audit logging** -- every proxied tool call logged with timestamp, caller, target, and status
- **Config drift detection** -- `fam drift` detects when generated configs have been modified outside FAM
- **No root required** -- daemon, keychain, auto-start, and data directory are all user-scoped

## Status

### Tested & Working

| Feature | Status | Notes |
|---|---|---|
| YAML config parsing + Zod validation | Tested | Schema validation, env var interpolation, cross-field checks |
| MCP proxy daemon (Fastify) | Tested | SSE + stdio transports, tool discovery, namespace prefixing |
| MCP forwarding to agents | Tested | Verified with OpenCode + Playwright MCP server |
| Config generation (all 17 agents) | Tested | Unit tests for every generator |
| Credential vault (OS keychain) | Tested | macOS Keychain via @napi-rs/keyring |
| Session token auth | Tested | SHA-256 hashing, constant-time comparison |
| Plan/apply/diff pipeline | Tested | Terraform-style add/change/remove with state tracking |
| Model provider config + resolution | Tested | Provider/alias references, credential resolution, role mapping |
| Audit logging (SQLite) | Tested | MCP call log + config change log |
| `fam init` interactive setup | Tested | Tool selection, MCP config import, scaffold generation |
| Hot-reload on config change | Tested | POST /api/v1/reload preserves upstream connections |

### Not Yet Tested / In Progress

| Feature | Status | Notes |
|---|---|---|
| LLM model config applied to agents | Not tested | Generators produce correct output (unit tested) but not verified end-to-end with live agents |
| OAuth2 credential flow | Not tested | Code complete, browser flow + token refresh not verified |
| Linux keychain (libsecret) | Not tested | Builds on Linux, keychain integration not verified |
| Windows support | Not tested | PowerShell install script exists, not verified |
| Multi-machine sync (git) | Not implemented | Planned for v1 |
| Config drift watch mode | Partial | `fam drift` works, `--watch` polling not verified |
| Knowledge store | Partial | SQLite store works, native tool integration not verified end-to-end |
| OpenClaw integration | Not tested | Generator complete, not verified with live OpenClaw |
| NemoClaw integration | Not tested | Generator complete, not verified with live NemoClaw |

## Supported Agents

| Agent | Config Target | MCP | Model Config |
|---|---|---|---|
| Claude Code | `claude_code` | `~/.claude/settings.json` | env block (API key, model, tiers) |
| OpenCode | `opencode` | `~/.config/opencode/opencode.json` | providers + agents (coder/task) |
| OpenHands | `openhands` | `~/.openhands/config.toml` | [llm] section |
| Aider | `aider` | -- | `.aider.conf.yml` (model/editor/weak) |
| Continue.dev | `continue_dev` | `~/.continue/config.yaml` | models[] with roles |
| OpenClaw | `openclaw` | `~/.openclaw/openclaw.json` | providers + tiers (primary/fallback/economy) |
| NemoClaw | `nemoclaw` | `~/.nemoclaw/openclaw.json` | env var hints (NEMOCLAW_*) |
| Gemini CLI | `gemini_cli` | `~/.gemini/settings.json` | model.name |
| Copilot CLI | `github_copilot` | `~/.copilot/mcp-config.json` | env var hints |
| Cursor | `cursor` | `~/.cursor/mcp.json` | GUI-only |
| VS Code | `vscode` | `.vscode/mcp.json` | Depends on extension |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | GUI-only |
| Zed | `zed` | Zed settings.json | GUI-only |
| Cline | `cline` | `cline_mcp_settings.json` | Partial |
| Roo Code | `roo_code` | `.roo/mcp.json` | GUI-only |
| Amazon Q | `amazon_q` | `~/.aws/amazonq/...` | CLI command hint |
| Generic | `generic` | `~/.fam/configs/<name>.json` | -- |

## Roadmap

### v0.1 (current -- alpha)
- [x] Core YAML config + Zod schema
- [x] MCP proxy daemon with SSE + stdio
- [x] Per-agent config generators (17 agents)
- [x] OS keychain credential vault
- [x] Terraform-style plan/apply/diff
- [x] Session token auth + per-profile scoping
- [x] Audit logging (SQLite)
- [x] LLM model provider config with role-based assignment
- [x] Daemon auto-start (launchd / systemd)
- [x] Config drift detection
- [ ] End-to-end testing with all major agents
- [ ] OAuth2 flow verification
- [ ] Linux + Windows platform testing

### v0.2
- [ ] `fam doctor` -- diagnose common issues (keychain access, port conflicts, missing deps)
- [ ] Model cost tracking and usage dashboards
- [ ] Profile templates (share agent configs as presets)
- [ ] Plugin system for community generators

### v1.0
- [ ] Multi-machine config sync via git
- [ ] Desktop UI (Tauri + Vue 3)
- [ ] Team/org config sharing
- [ ] Encrypted config export/import

## Commands

| Command | Description |
|---|---|
| `fam init` | Create a new fam.yaml |
| `fam plan` | Show what apply would do |
| `fam apply` | Apply configuration |
| `fam validate` | Pre-apply validation |
| `fam status` | Health overview |
| `fam secret set/get/list/delete` | Manage credentials |
| `fam register <profile>` | Generate session tokens |
| `fam daemon start/stop/status` | Manage the proxy daemon |
| `fam mcp add/remove/list` | Manage MCP servers |
| `fam log` | Query audit log |
| `fam drift` | Check for config file drift |

## Architecture

See [DESIGN.md](docs/DESIGN.md) for the full architecture, data models, and implementation details.

## Development

```bash
git clone https://github.com/Sweet-Papa-Technologies/FAM.git
cd FAM
npm install
npm test
npx tsx src/index.ts --help
```

## License

MIT
