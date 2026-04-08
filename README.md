# FAM -- FoFo Agent Manager

> One config. Every agent.

A local-first CLI + daemon that acts as the universal source of truth for AI agent configuration, credentials, and lifecycle management.

## Quick Start

```bash
npm install -g @sweetpapatech/fam

# Create your config
fam init

# Review what will change
fam plan

# Apply configuration
fam apply

# Start the MCP proxy daemon
fam daemon start
```

## What FAM Does

- **Single YAML config** -> generates tool-specific configs for Claude Code, Cursor, VS Code, OpenHands, Aider, Continue.dev, and more
- **LLM model management** -> define providers and models centrally, assign to agents with role-based config (coder/editor/fast/powerful)
- **OS keychain vault** -> credentials stored securely, injected at runtime, never in config files
- **MCP proxy daemon** -> one endpoint (`localhost:7865`) proxies all MCP servers with per-tool scoping
- **Audit logging** -> every proxied call logged with timestamp, caller, target, and status

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

## Architecture

See `docs/requirements-design.md` for the full architecture, data models, and implementation details.

## Development

```bash
git clone https://github.com/sweetpapatech/fam.git
cd fam
npm install
npm test
npx tsx src/index.ts --help
```

## License

MIT
