# Setting Up OpenCode with FAM

This guide walks through connecting [OpenCode](https://opencode.ai) to FAM so all your MCP servers are managed from a single config.

**What you'll get:** OpenCode connects to FAM as one MCP server, and through FAM it can access GitHub, your local filesystem, n8n workflows, or any other MCP server you've configured -- all with automatic credential injection and audit logging.

---

## Prerequisites

- FAM installed and working (`fam --version`)
- OpenCode installed (`opencode --version`, v1.3+)
- At least one MCP server configured in your `fam.yaml`

If you haven't installed FAM yet, see the [Installation Guide](./installation.md).

---

## Step 1: Add an OpenCode Profile to fam.yaml

Open your `fam.yaml` and add an OpenCode profile. This defines which MCP servers OpenCode is allowed to access.

```yaml
# fam.yaml

# ... your existing credentials and mcp_servers ...

profiles:
  # ... your existing profiles ...

  opencode:
    description: "OpenCode IDE"
    config_target: opencode
    allowed_servers:
      - github
      - filesystem
      # Add any other servers OpenCode should have access to

generators:
  # ... your existing generators ...

  opencode:
    output: ~/.config/opencode/opencode.json
    format: opencode_config
```

**What each field means:**

- `config_target: opencode` tells FAM to use the OpenCode config generator
- `allowed_servers` controls which upstream MCP servers OpenCode can see
- `generators.opencode.output` is where FAM writes the OpenCode config file
- You can name the profile anything -- `opencode` is just a convention

### Example: Full fam.yaml with OpenCode

Here's a complete example managing both Claude Code and OpenCode:

```yaml
version: "0.1"

settings:
  daemon:
    port: 7865

credentials:
  github-pat:
    type: api_key
    description: "GitHub Personal Access Token"

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

  opencode:
    description: "OpenCode"
    config_target: opencode
    allowed_servers: [github, filesystem]

generators:
  claude_code:
    output: ~/.claude.json
    format: claude_mcp_config

  opencode:
    output: ~/.config/opencode/opencode.json
    format: opencode_config

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile and permissions"
  log_action:
    enabled: true
    description: "Report actions for audit trail"
  list_servers:
    enabled: true
    description: "List available MCP servers"
  health:
    enabled: true
    description: "Daemon health status"
```

---

## Step 2: Store Your Credentials

If you haven't already, store any credentials that your MCP servers need:

```bash
fam secret set github-pat
# Enter value: ghp_xxxxxxxxxxxxxxxxxxxx
```

---

## Step 3: Review and Apply

```bash
# Preview what will change
fam plan
```

You should see output like:

```
FAM v0.1.0 -- Planning changes...

Profile changes:
  + opencode  (NEW profile (servers: github, filesystem))

Config files to update:
  + opencode  (~/.config/opencode/opencode.json (new file))

Plan: 2 to add, 0 to change, 0 to destroy.
```

Apply it:

```bash
fam apply
```

FAM will:
1. Generate a session token for the `opencode` profile (save this!)
2. Write `~/.config/opencode/opencode.json` with the FAM MCP entry
3. Update state

**Important:** When FAM generates the OpenCode config, it will ask how to handle the existing file if one already exists. Choose:
- **Import & Manage** if you want FAM to take over the file entirely
- **Skip** if you want to add the FAM entry to your OpenCode config manually

---

## Step 4: Start the FAM Daemon

```bash
fam daemon start --foreground
```

Leave this running in a terminal tab, or set up auto-start:

```bash
fam daemon install
```

---

## Step 5: Verify in OpenCode

Open OpenCode and check that the MCP connection is working:

```bash
opencode mcp list
```

You should see FAM listed as a connected MCP server. When you start a session in OpenCode, it will have access to all the tools from your allowed servers, plus FAM's native tools.

### What OpenCode Sees

When OpenCode connects to FAM and calls `tools/list`, it gets tools like:

```
github__repos_list          - [github] List repositories
github__issues_create       - [github] Create an issue
github__pr_merge            - [github] Merge a pull request
filesystem__read_file       - [filesystem] Read a file
filesystem__list_directory  - [filesystem] List directory contents
fam__whoami                 - Returns your profile and permissions
fam__log_action             - Report actions for audit trail
fam__list_servers           - List available MCP servers
fam__health                 - Daemon health status
```

All tool names are prefixed with their server namespace so there are no name collisions.

---

## Step 6: Manual Setup (Alternative)

If you chose **Skip** during `fam apply`, or if you prefer to manage your OpenCode config manually, add this to your `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "fam": {
      "type": "remote",
      "url": "http://localhost:7865/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer YOUR_SESSION_TOKEN_HERE"
      }
    }
  }
}
```

Replace `YOUR_SESSION_TOKEN_HERE` with the token from `fam register opencode` (or the token shown during `fam apply`).

If you've lost your token, rotate it:

```bash
fam register --rotate opencode
# New token printed -- use this in your config
```

---

## Scoping: Control What OpenCode Can Access

The `allowed_servers` list in your profile controls exactly which MCP servers OpenCode can reach through FAM. Servers not in this list are completely invisible -- OpenCode won't even know they exist.

```yaml
profiles:
  opencode:
    allowed_servers:
      - github        # Can access GitHub
      - filesystem    # Can access local files
    denied_servers:
      - jira          # Explicitly blocked (even if added to allowed later)
```

To change access, edit `fam.yaml` and re-apply:

```bash
# Add a new server to OpenCode's access
vim fam.yaml  # add "n8n" to allowed_servers

fam plan      # verify the change
fam apply     # apply it

# If daemon is running, it reloads automatically
```

---

## Monitoring OpenCode's Activity

FAM logs every MCP call OpenCode makes:

```bash
# See recent activity from OpenCode
fam log --profile opencode

# See activity from the last hour
fam log --profile opencode --since 1h

# Export for analysis
fam log export --format json --profile opencode -o opencode-audit.json
```

---

## Troubleshooting

### OpenCode says "No MCP servers configured"

1. Check that `~/.config/opencode/opencode.json` exists and contains the `mcp.fam` entry
2. Verify the FAM daemon is running: `fam daemon status`
3. Check the session token is valid: `fam register --rotate opencode` and update the config

### OpenCode connects but shows no tools

1. Check the daemon is running: `fam daemon status`
2. Check the profile has servers: `fam plan` should show the profile's allowed servers
3. Check the upstream servers are healthy: `fam status`
4. Try calling the health endpoint directly:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:7865/health
   ```

### "Rate limit exceeded"

FAM enforces a per-profile rate limit of 200 requests per minute. If OpenCode is making rapid-fire tool calls, this limit may be hit. Wait 60 seconds and try again. If this is a regular issue, the limit can be adjusted in a future release.

### OpenCode can see tools but calls fail

Check the audit log for errors:

```bash
fam log --profile opencode --status error --since 1h
```

Common causes:
- Credential not stored: `fam secret list` to check
- Upstream server unreachable: `fam status` to check server health
- Tool scoping: the tool may be from a server not in your `allowed_servers`

---

## Next Steps

- Add more MCP servers to your `fam.yaml` and give OpenCode access
- Set up other tools (Claude Code, Cursor) with their own profiles
- Use `fam log` to monitor agent activity across all your tools
- Read the full [User Guide](./index.md) for all commands and concepts
