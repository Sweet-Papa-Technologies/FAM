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
| MCP forwarding to agents | Tested | Verified end-to-end with OpenCode, Claude Code, Gemini CLI, Aider, OpenClaw |
| Config generation (all 17 agents) | Tested | Unit tests for every generator |
| Credential vault (OS keychain) | Tested | macOS Keychain via @napi-rs/keyring; gnome-keyring verified in Docker |
| Session token auth | Tested | SHA-256 hashing, constant-time comparison |
| Plan/apply/diff pipeline | Tested | Terraform-style add/change/remove with state tracking |
| Multi-file generator output | Tested | `additionalFiles` mechanism for agents that read from >1 file (Claude Code) |
| Model provider config + resolution | Tested | Provider/alias references, credential resolution, role mapping |
| Audit logging (SQLite) | Tested | MCP call log + config change log |
| `fam init` interactive setup | Tested | Tool selection, MCP config import, scaffold generation |
| Hot-reload on config change | Tested | POST /api/v1/reload preserves upstream connections |

**Unit test suite:** 457 tests, all passing. Runs in ~6s.

### Docker E2E

Run via `npm run test:docker` — spins up a Linux container with Node 22, real gnome-keyring, and installs real agents.

| Category | Status | What it covers |
|---|---|---|
| `core-cli` | Passing | `fam plan/apply/validate/status/drift` full lifecycle |
| `daemon` | Passing | health, tools/list, tools/call, auth enforcement, native tools, shutdown |
| `generators` | 1 pre-existing drift¹ | Structural check of each generator's output shape |
| `vault` | Passing | set/get/delete/overwrite via real libsecret |
| `agent-integration` | Passing | Install each installable agent and verify FAM's config file is generated |
| `model-config` | 2 pre-existing drift¹ | Model resolver → generator output mapping per agent |
| `runtime-verification` | **5 passing, 1 skipped** | Installs agent → `fam apply` → runs agent's own `mcp list` to confirm FAM is registered |

¹ Three tests in `generators` and `model-config` assert output shapes that drifted from the current generator implementations (windsurf `serverUrl` vs `url`; opencode model path; cline model key). These are stale test expectations, not functionality regressions — flagged for follow-up.

#### Officially supported agents (runtime-verified)

For these agents, the CI container installs the real binary, runs `fam apply`, starts the daemon, then executes the agent's own CLI to confirm FAM is registered end-to-end. If the model is served by a reachable Ollama endpoint with `gemma4:e2b` pulled, a live prompt is also sent and a non-empty response is asserted.

| Agent | Runtime command asserted | Live prompt against `gemma4:e2b` | Status |
|---|---|---|---|
| Claude Code | `claude mcp list`, `claude mcp get fam` | N/A (Anthropic-only) | ✅ Passing |
| OpenCode | `opencode mcp list` | Yes, via `opencode run` | ✅ Passing |
| Gemini CLI | `gemini mcp list --debug` | N/A (Google-only) | ✅ Passing |
| Aider | `.aider.conf.yml` assertions | Yes, via `aider --message` | ✅ Passing |
| OpenClaw | `openclaw mcp list` | Opt-in | ✅ Passing |
| Amazon Q | `q mcp list` | N/A | ⏭️ Skipped (requires `E2E_AMAZONQ_AUTHED=1` with pre-baked AWS SSO cache) |

To enable the live prompt leg of the runtime tests:
```bash
ollama pull gemma4:e2b
E2E_LLM_URL=http://host.docker.internal:11434/v1 bash test/docker-e2e/run.sh runtime-verification
```
If Ollama isn't reachable, structural checks still run; only the live prompt assertions are skipped.

#### Experimental / schema-only (config generated, not runtime-verified)

Configs are generated and structurally tested, but the agent's runtime isn't exercised in CI. These agents may work — they just haven't been end-to-end verified on every release.

- **GUI-only** (cannot be runtime-verified in a headless container): Cursor, VS Code, Windsurf, Zed, Cline, Roo Code
- **Other**: OpenHands (upstream pip dependency conflict), NemoClaw, GitHub Copilot CLI, Continue.dev, Generic

### Not Yet Tested

| Feature | Status | Notes |
|---|---|---|
| OAuth2 credential flow | Not tested | Code complete, browser flow + token refresh not verified |
| Windows support | Not tested | PowerShell install script exists, not verified |
| Multi-machine sync (git) | Not implemented | Planned for v1 |
| Config drift watch mode | Partial | `fam drift` works, `--watch` polling not verified |

## Supported Agents

Legend: **✅ Runtime-verified** = the agent is installed in CI and asked to confirm FAM is registered. **🧪 Experimental** = config is generated and structurally tested, but the agent's runtime isn't exercised in CI.

| Agent | Support | Config Target | MCP Output | Model Config |
|---|---|---|---|---|
| Claude Code | ✅ | `claude_code` | `~/.claude.json` (mcpServers, type:http) + `~/.claude/settings.json` (env block)² | env block (API key, model, tiers) |
| OpenCode | ✅ | `opencode` | `~/.config/opencode/opencode.json` | providers + agents (coder/task) |
| Gemini CLI | ✅ | `gemini_cli` | `~/.gemini/settings.json` (type:http) | model.name |
| Aider | ✅ | `aider` | -- (no MCP) | `.aider.conf.yml` (model/editor/weak) |
| OpenClaw | ✅ | `openclaw` | `~/.openclaw/openclaw.json` | providers + tiers (primary/fallback/economy) |
| Amazon Q | ✅¹ | `amazon_q` | `~/.aws/amazonq/agents/default.json` | CLI command hint |
| OpenHands | 🧪 | `openhands` | `~/.openhands/config.toml` | [llm] section |
| Continue.dev | 🧪 | `continue_dev` | `~/.continue/config.yaml` | models[] with roles |
| NemoClaw | 🧪 | `nemoclaw` | `~/.nemoclaw/openclaw.json` | env var hints (NEMOCLAW_*) |
| Copilot CLI | 🧪 | `github_copilot` | `~/.copilot/mcp-config.json` | env var hints |
| Cursor | 🧪 | `cursor` | `~/.cursor/mcp.json` | GUI-only |
| VS Code | 🧪 | `vscode` | `.vscode/mcp.json` | Depends on extension |
| Windsurf | 🧪 | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | GUI-only |
| Zed | 🧪 | `zed` | Zed settings.json | GUI-only |
| Cline | 🧪 | `cline` | `cline_mcp_settings.json` | Partial |
| Roo Code | 🧪 | `roo_code` | `.roo/mcp.json` | GUI-only |
| Generic | 🧪 | `generic` | `~/.fam/configs/<name>.json` | -- |

¹ Amazon Q runtime verification requires AWS SSO auth. CI skips it unless `E2E_AMAZONQ_AUTHED=1` is set with a pre-baked SSO cache.

² Claude Code 2.x reads MCP servers from `~/.claude.json` (top-level `mcpServers`, entry shape `{type: "http", url, headers}`) and env vars from `~/.claude/settings.json`. FAM writes both files via the generator's `additionalFiles` mechanism; existing keys in either file are preserved via deep merge.

## Roadmap

### v0.1 (current -- alpha)
- [x] Core YAML config + Zod schema
- [x] MCP proxy daemon with SSE + stdio
- [x] Per-agent config generators (17 agents)
- [x] Multi-file generator output (Claude Code writes ~/.claude.json + ~/.claude/settings.json)
- [x] OS keychain credential vault
- [x] Terraform-style plan/apply/diff
- [x] Session token auth + per-profile scoping
- [x] Audit logging (SQLite)
- [x] LLM model provider config with role-based assignment
- [x] Daemon auto-start (launchd / systemd)
- [x] Config drift detection
- [x] Docker E2E test harness (7 categories, runtime-verification included)
- [x] Linux platform testing (Docker container with real gnome-keyring)
- [x] Runtime verification for Claude Code, OpenCode, Gemini CLI, Aider, OpenClaw
- [ ] Runtime verification for Amazon Q (blocked on SSO auth in headless CI)
- [ ] OAuth2 flow verification
- [ ] Windows platform testing
- [ ] Fix 3 pre-existing stale structural tests (windsurf/opencode/cline)

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
nvm use 22            # FAM requires Node.js >= 22
npm install
npm test              # 457 unit + in-process E2E tests (~6s)
npx tsx src/index.ts --help
```

### Testing

FAM has three test layers:

| Layer | Command | What It Tests | Requirements |
|---|---|---|---|
| Unit tests | `npm test` | 457 tests — config parsing, generators (all 17), diff, vault, daemon protocol | Node 22 |
| Docker E2E | `npm run test:docker` | 7 categories (~59 tests) — full lifecycle in a Linux container with real keychain + real agents | Docker |
| Docker (one category) | `bash test/docker-e2e/run.sh <category>` | Run a single test category | Docker |

**Docker E2E categories:** `core-cli`, `daemon`, `generators`, `vault`, `agent-integration`, `model-config`, `runtime-verification`

Run one category only:
```bash
bash test/docker-e2e/run.sh runtime-verification
```

To use a custom LLM endpoint (required for live prompt smoke tests in `runtime-verification`):
```bash
ollama pull gemma4:e2b
E2E_LLM_URL=http://host.docker.internal:11434/v1 npm run test:docker
```

### Known test drift

Three structural tests in the `generators` and `model-config` docker-e2e categories still assert output shapes from earlier generator versions and fail on the current code:

- `generators/generator-windsurf` — expects `mcpServers.fam.url`; generator now writes `mcpServers.fam.serverUrl`
- `model-config/model-opencode` — expects `agents.coder.model`; generator writes top-level `model`
- `model-config/model-cline` — expects `cline.apiModelId`; generator shape has changed

These are stale test expectations, not functional regressions. Safe to treat as known failures until updated.

## License

MIT
