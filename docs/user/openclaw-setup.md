# Setting Up OpenClaw with FAM

This guide walks through installing [OpenClaw](https://github.com/openclaw/openclaw) and connecting it to FAM so all your MCP servers and model providers are managed from a single config.

**What you'll get:** OpenClaw uses FAM as one MCP endpoint and reads its model providers from a FAM-managed config. Through FAM, OpenClaw can access GitHub, your filesystem, n8n, or any other MCP server you've configured -- with automatic credential injection and audit logging. FAM also generates OpenClaw's tiered model config (`primary` / `fallback` / `economy`).

---

## Prerequisites

- FAM installed and working (`fam --version`)
- Node.js 20+ (required by OpenClaw)
- At least one MCP server configured in your `fam.yaml`

If you haven't installed FAM yet, see the [Installation Guide](./installation.md).

---

## Step 1: Install OpenClaw

OpenClaw ships as a standalone CLI. Install it with npm:

```bash
npm install -g @openclaw/cli
```

Verify the install:

```bash
openclaw --version
```

The first time you run OpenClaw, it creates `~/.openclaw/` for its config and state files.

---

## Step 2: Add an OpenClaw Profile to fam.yaml

Open your `fam.yaml` and add credentials, a model provider, an OpenClaw profile, and a generator entry.

### Minimal Example (Anthropic models)

```yaml
version: "0.1"

credentials:
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
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    transport: stdio
    description: "Local filesystem access"

profiles:
  openclaw:
    description: "OpenClaw with tiered Anthropic models"
    config_target: openclaw
    model: anthropic/sonnet
    model_roles:
      primary:  anthropic/opus     # complex tasks: code gen, architecture
      fallback: anthropic/sonnet   # used when primary is unavailable
      economy:  anthropic/haiku    # cheap model for summaries / commit messages
    allowed_servers:
      - filesystem

generators:
  openclaw:
    output: ~/.openclaw/openclaw.json
    format: openclaw_config
```

**What each field means:**

- `config_target: openclaw` tells FAM to use the OpenClaw config generator
- `model_roles` map FAM role names to OpenClaw's tiered model system:
  - `primary` -- complex tasks (code generation, architecture review, bug analysis)
  - `fallback` -- used when the primary provider is unavailable
  - `economy` -- simple tasks (file summaries, git messages, format checks)
- `allowed_servers` controls which upstream MCP servers OpenClaw can see
- `generators.openclaw.output` is where FAM writes `openclaw.json` (it also writes `models.yaml` to the same directory)

### Example: Multi-Provider with Local Fallback (Ollama)

OpenClaw is one of the few agents in FAM that fully supports custom OpenAI-compatible providers like Ollama. Here's a setup that uses Anthropic for the heavy work and a local Ollama model for cheap economy tasks:

```yaml
credentials:
  anthropic-key:
    type: api_key
    description: "Anthropic API Key"

models:
  anthropic:
    provider: anthropic
    credential: anthropic-key
    models:
      sonnet: claude-sonnet-4-20250514
      opus:   claude-opus-4-20250514

  local:
    provider: openai_compatible
    credential: null
    base_url: http://192.168.1.99:11434/v1
    models:
      gemma: "gemma3:27b-instruct-q4_K_M"

profiles:
  openclaw:
    description: "OpenClaw with cloud + local hybrid models"
    config_target: openclaw
    model: anthropic/sonnet
    model_roles:
      primary:  anthropic/opus
      fallback: anthropic/sonnet
      economy:  local/gemma            # Local Ollama for cheap tasks
    allowed_servers:
      - filesystem
      - github
```

---

## Step 3: Store Your Credentials

Store any API keys your model providers and MCP servers need:

```bash
fam secret set anthropic-key
# Enter value: sk-ant-xxxxxxxxxxxxxxxxxxxx

# If using GitHub MCP server, etc.
fam secret set github-pat
```

You don't need to store anything for keyless local providers like Ollama.

---

## Step 4: Review and Apply

```bash
fam plan
```

You should see something like:

```
FAM -- Planning changes...

Credential changes:
  + anthropic-key  (will prompt for value on apply)

Model provider changes:
  + anthropic  (anthropic (sonnet, opus, haiku))

Profile changes:
  + openclaw  (NEW profile (servers: filesystem))

Config files to update:
  + openclaw  (~/.openclaw/openclaw.json (new file))

Plan: 4 to add, 0 to change, 0 to destroy.
```

Apply it:

```bash
fam apply
```

FAM will:
1. Generate a session token for the `openclaw` profile (save this -- it's shown once)
2. Write `~/.openclaw/openclaw.json` with the FAM MCP entry + model providers
3. Write `~/.openclaw/models.yaml` with the tier config (`primary` / `fallback` / `economy`)
4. Update state

If `~/.openclaw/openclaw.json` already exists, FAM will ask how to handle it:
- **Overwrite** -- Backup the existing file and replace it entirely (recommended for clean setup)
- **Skip** -- Leave the file alone (you'll need to add the FAM entry manually)

---

## Step 5: Start the FAM Daemon

```bash
fam daemon start --foreground
```

Leave this running in a terminal tab, or set up auto-start:

```bash
fam daemon install
```

---

## Step 6: Verify in OpenClaw

Open OpenClaw and check that it picks up the FAM-managed config:

```bash
openclaw --check
```

You should see:
- The model providers from your `fam.yaml` listed
- The tier assignments (primary / fallback / economy)
- FAM listed as a connected MCP server
- The MCP tools from your allowed servers

Run a quick interactive session to confirm tool calls work:

```bash
openclaw chat
```

Inside the session, ask OpenClaw to call a tool from one of your MCP servers (e.g. "list the files in the current directory" if you have the filesystem server enabled).

---

## What FAM Generates for OpenClaw

After `fam apply`, two files are written:

### `~/.openclaw/openclaw.json`

```json
{
  "mcpServers": {
    "fam": {
      "transport": "http",
      "url": "http://127.0.0.1:7865/mcp",
      "headers": {
        "Authorization": "Bearer fam_sk_ocl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  },
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "sk-ant-xxxxxxxxxxxxxxxxxxxx",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-20250514", "name": "claude-sonnet-4-20250514" },
          { "id": "claude-opus-4-20250514",   "name": "claude-opus-4-20250514"   },
          { "id": "claude-haiku-4-5-20251001","name": "claude-haiku-4-5-20251001"}
        ]
      }
    }
  }
}
```

### `~/.openclaw/models.yaml`

```yaml
# OpenClaw model tiers — managed by FAM
tiers:
  primary:
    provider: anthropic
    model: claude-opus-4-20250514
    max_tokens: 8192
    temperature: 0.3
  fallback:
    provider: anthropic
    model: claude-sonnet-4-20250514
    max_tokens: 4096
    temperature: 0.3
  economy:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    max_tokens: 2048
    temperature: 0.2
```

---

## Scoping: Control What OpenClaw Can Access

The `allowed_servers` list in your profile controls exactly which MCP servers OpenClaw can reach through FAM. Servers not in this list are completely invisible -- OpenClaw won't know they exist.

```yaml
profiles:
  openclaw:
    allowed_servers:
      - filesystem    # Can access local files
      - github        # Can access GitHub
    denied_servers:
      - jira          # Explicitly blocked even if added to allowed later
```

To change access, edit `fam.yaml` and re-apply:

```bash
vim fam.yaml          # add/remove servers
fam plan              # verify the change
fam apply             # apply it
```

---

## Monitoring OpenClaw's Activity

FAM logs every MCP call OpenClaw makes:

```bash
# Recent activity from OpenClaw
fam log --profile openclaw

# Last hour only
fam log --profile openclaw --since 1h

# Errors only
fam log --profile openclaw --status error

# Export for analysis
fam log export --format json --profile openclaw -o openclaw-audit.json
```

---

## Troubleshooting

### OpenClaw can't reach the FAM MCP server

1. Confirm the daemon is running: `fam daemon status`
2. Check the URL in `~/.openclaw/openclaw.json` matches your daemon port (default `7865`)
3. Confirm OpenClaw is on a recent version that supports HTTP MCP transport
4. Test the endpoint directly:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:7865/health
   ```

### "Unknown provider" or "model not found"

1. Check that the provider name in `models.yaml` matches the key in `openclaw.json`'s `models.providers`
2. Verify the model ID exists in the `models` array of the provider
3. Re-run `fam apply` to regenerate both files in sync

### OpenClaw shows tools but tool calls fail

Check the audit log for errors:

```bash
fam log --profile openclaw --status error --since 1h
```

Common causes:
- Credential not stored: `fam secret list` to check
- Upstream server unreachable: `fam status`
- The tool belongs to a server not in your `allowed_servers`

### Session token lost

Rotate it and update the config:

```bash
fam register --rotate openclaw
# New token printed -- FAM also rewrites openclaw.json with the new value
```

Or just re-run `fam apply` -- FAM will detect the missing token and generate a fresh one.

### `~/.openclaw/openclaw.json` was overwritten by something else

OpenClaw's onboarding wizard or another tool may have overwritten the FAM-generated file. Check for drift and re-apply:

```bash
fam drift              # Show what changed since last apply
fam apply              # Restore the FAM-managed config
```

---

## How OpenClaw's Tier System Maps to FAM Roles

OpenClaw uses three model tiers, and FAM exposes them through the `model_roles` map on a profile:

| FAM role | OpenClaw tier | Typical use |
|---|---|---|
| `primary` | `primary` | Complex tasks: code generation, architecture review, bug analysis |
| `fallback` | `fallback` | Used when the primary provider is unavailable |
| `economy` | `economy` | Cheap tasks: file summaries, commit messages, format checks |

The default `model:` field on the profile is used when no `primary` role is set. If you want fine-grained control, always set all three roles explicitly.

You can mix providers across tiers. For example, use Anthropic for the primary tier and a local Ollama instance for the economy tier to save on API costs.

---

## Next Steps

- Add more MCP servers to your `fam.yaml` and give OpenClaw access to them
- Set up additional agents (Claude Code, OpenCode, Cursor) with their own profiles -- they can all share the same MCP servers and credentials
- Use `fam log` to monitor OpenClaw's activity across all your tools
- Read the full [User Guide](./index.md) for all FAM commands and concepts
