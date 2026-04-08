# Installing FAM

There are two ways to install FAM: from npm (recommended) or building from source.

---

## Prerequisites

- **Node.js 22+** -- FAM uses modern Node.js features. Check with `node --version`.
- **npm** -- Comes with Node.js. Check with `npm --version`.
- **OS keychain** -- FAM stores credentials in your system's native keychain:
  - macOS: Keychain Access (built in)
  - Linux: libsecret (install `gnome-keyring` or `libsecret-tools` if not present)
  - Windows: Credential Manager (built in)

---

## No Root Required

FAM is designed to run entirely as your normal user — no `sudo`, no admin privileges, no elevation.

- **Credentials**: `@napi-rs/keyring` uses your **user-level** OS keychain (macOS login keychain, Linux GNOME Keyring / KDE Wallet, Windows Credential Manager). These are per-user by default — no system keychain access needed.
- **Daemon**: Binds to `localhost:7865` (port > 1024, no root needed). Runs as a user process.
- **Auto-start**: Uses user-level service managers (`~/Library/LaunchAgents` on macOS, `~/.config/systemd/user/` on Linux) — not system-level daemons.
- **Data directory**: Everything lives in `~/.fam/` with owner-only permissions (`chmod 700`).
- **Install location**: Use `--prefix ~` to install to `~/bin/` instead of `/usr/local/bin/`:

```bash
# No sudo needed
./scripts/install.sh --prefix ~
```

The *only* scenario that needs `sudo` is installing to a system directory like `/usr/local/bin`, which is the default prefix. If you use `--prefix ~` or install via `npm install -g` with a user-writable npm prefix, no elevation is ever required.

---

## Option 1: Install from npm

```bash
npm install -g @sweetpapatech/fam
```

Verify the installation:

```bash
fam --version
# 0.1.0

fam --help
```

### Updating

```bash
npm update -g @sweetpapatech/fam
```

### Uninstalling

```bash
npm uninstall -g @sweetpapatech/fam
```

This removes the CLI but leaves your `~/.fam/` directory and `fam.yaml` intact.

---

## Option 2: Build from Source

Clone the repository and build locally. This is useful if you want to contribute or run the latest unreleased code.

### Clone and install

```bash
git clone https://github.com/Sweet-Papa-Technologies/FAM.git
cd FAM
npm install
```

### Run in development mode

Use `tsx` to run directly from TypeScript source without building:

```bash
# Run any command
npx tsx src/index.ts --help
npx tsx src/index.ts plan
npx tsx src/index.ts daemon start --foreground
```

You can create an alias for convenience:

```bash
# Add to your shell profile (~/.zshrc or ~/.bashrc)
alias fam="npx tsx /path/to/fam/src/index.ts"
```

### Install locally (not published to npm yet)

Since FAM isn't on the npm registry yet, use one of these methods to install from your local clone:

**Option A: `npm link`** (recommended for development)

Creates a global symlink to your local repo. Changes you make to the source are reflected immediately after rebuilding.

```bash
npm run build
npm link
fam --help
```

To unlink later: `npm unlink -g @sweetpapatech/fam`

**Option B: `npm install -g .`** (installs a snapshot)

Installs the built package globally as if it came from npm. This copies the files, so source changes require re-running the command.

```bash
npm run build
npm install -g .
fam --help
```

To uninstall: `npm uninstall -g @sweetpapatech/fam`

**Option C: Install script** (full setup with daemon auto-start)

The install script builds, installs to a prefix directory, and sets up daemon auto-start (launchd on macOS, systemd on Linux). No sudo needed with `--prefix ~`.

```bash
./scripts/install.sh --prefix ~    # Installs to ~/bin/fam
```

On Windows:
```powershell
.\scripts\install.ps1              # Installs to %LOCALAPPDATA%\fam
```

**Option D: Run directly without installing**

Skip the install entirely and run from source via `tsx`:

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts plan
```

You can alias this for convenience:
```bash
# Add to ~/.zshrc or ~/.bashrc
alias fam="npx tsx /path/to/fam/src/index.ts"
```

### Build for production

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Run tests

```bash
# All tests (unit + E2E)
npm test

# Just unit tests
npx vitest run test/unit/

# Just the E2E integration test
npx vitest run test/e2e/

# With watch mode during development
npx vitest test/unit/
```

### Lint and type-check

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript strict mode
```

---

## First Run

After installation, set up FAM:

### 1. Create your config

```bash
fam init
```

This walks you through an interactive setup:
- Which AI tools you use (Claude Code, Cursor, VS Code, OpenCode, etc.)
- Scans for existing MCP configs and offers to import them
- Creates a `fam.yaml` in the current directory

### 2. Add your credentials

Declare credentials in `fam.yaml`, then store the actual values:

```bash
fam secret set github-pat
# Enter value: ****

fam secret set anthropic-key
# Enter value: ****
```

### 3. Review and apply

```bash
# See what will change
fam plan

# Apply it
fam apply
```

`fam apply` will:
- Generate config files for each tool profile
- Create session tokens for each profile (shown once -- save them)
- Write state to `~/.fam/state.json`
- Create instruction files (`FAM.md`) per profile

### 4. Start the daemon

```bash
fam daemon start --foreground
```

Your tools can now connect to `localhost:7865` and discover their MCP tools.

### 5. (Optional) Auto-start on login

```bash
fam daemon install
```

This creates a launchd plist (macOS) or systemd user unit (Linux) so the daemon starts automatically when you log in.

---

## Directory Layout

After setup, your filesystem looks like this:

```
./fam.yaml                          # Your config (check into git)
~/.fam/
  state.json                        # Last-applied state
  sessions.json                     # Token hashes
  audit.db                          # Audit log (SQLite)
  fam.pid                           # Daemon PID (when running)
  configs/                          # Generated tool configs
  instructions/                     # Generated FAM.md files
```

The `fam.yaml` file is safe to commit to version control. It contains no secrets -- credentials are declared by name only, with actual values stored in the OS keychain.

---

## Troubleshooting

### "No fam.yaml found"

FAM looks for `fam.yaml` in the current directory first, then `~/.fam/fam.yaml`. Either:
- `cd` to the directory containing your `fam.yaml`
- Use `--config /path/to/fam.yaml`

### "Keychain access denied"

On macOS, the first time FAM accesses the keychain you may see a system prompt asking to allow access. Click "Always Allow" for the terminal or IDE that's running FAM.

On Linux, make sure `gnome-keyring` or an equivalent secret service is running:

```bash
# Check if secret service is available
dbus-send --session --print-reply \
  --dest=org.freedesktop.secrets /org/freedesktop/secrets \
  org.freedesktop.DBus.Peer.Ping
```

### "Port 7865 already in use"

Another instance of FAM (or another service) is using the port. Either:
- Stop the other process: `fam daemon stop` or `lsof -i :7865`
- Change the port in `fam.yaml`:
  ```yaml
  settings:
    daemon:
      port: 7866
  ```

### "Daemon is already running"

```bash
fam daemon stop
fam daemon start --foreground
```

If stop fails (stale PID file), FAM will automatically clean it up on the next start.

### Tests are failing

```bash
# Make sure dependencies are installed
npm install

# Run with verbose output
npx vitest run --reporter=verbose
```

---

## Next Steps

- [Set up OpenCode with FAM](./opencode-setup.md)
- Read the full [CLI reference](./index.md#cli-reference)
