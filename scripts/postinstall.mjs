#!/usr/bin/env node
/**
 * postinstall.mjs — Lightweight post-install hook for npm.
 *
 * Runs after `npm install -g @sweetpapatech/fam`.
 * Creates ~/.fam/ data directory and prints setup guidance.
 *
 * Design constraints:
 *   - Never throws (a failing postinstall blocks npm install)
 *   - Silent in CI environments
 *   - Silent for local (non-global) installs
 *   - Cross-platform (macOS, Linux, Windows)
 */

import { mkdirSync, chmodSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { execSync } from 'node:child_process'

// ─── Context Detection ──────────────────────────────────────────

const isGlobal =
  process.env.npm_config_global === 'true' ||
  (process.env.npm_config_local_prefix != null &&
    process.env.npm_config_prefix != null &&
    process.env.npm_config_local_prefix !== process.env.npm_config_prefix)

const isCI = !!(
  process.env.CI ||
  process.env.CONTINUOUS_INTEGRATION ||
  process.env.BUILD_NUMBER ||
  process.env.GITHUB_ACTIONS
)

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const isSudo = !!process.env.SUDO_USER
const plat = platform()

// ─── Early Exit ─────────────────────────────────────────────────

if (!isGlobal || isCI) {
  process.exit(0)
}

// ─── Helpers ────────────────────────────────────────────────────

function log(msg) {
  console.log(`  ${msg}`)
}

function warn(msg) {
  console.log(`  \u26A0 ${msg}`)
}

function commandExists(cmd) {
  try {
    execSync(plat === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

// ─── Create ~/.fam/ ─────────────────────────────────────────────

try {
  const famDir = join(homedir(), '.fam')
  const subdirs = ['configs', 'instructions']

  mkdirSync(famDir, { recursive: true })
  for (const sub of subdirs) {
    mkdirSync(join(famDir, sub), { recursive: true })
  }

  // Set permissions on Unix (Windows ignores chmod)
  if (plat !== 'win32') {
    try {
      chmodSync(famDir, 0o700)
    } catch {
      // Non-fatal — directory still works
    }
  }

  // If running as sudo, fix ownership so the real user can access ~/.fam
  if (isRoot && isSudo) {
    const realUser = process.env.SUDO_USER
    try {
      execSync(`chown -R ${realUser} ${famDir}`, { stdio: 'ignore' })
    } catch {
      // Non-fatal
    }
  }
} catch {
  // Directory creation is best-effort. User can create it manually
  // or it'll be created on first `fam` command.
}

// ─── Platform Checks ────────────────────────────────────────────

console.log()

if (isRoot) {
  warn('FAM was installed as root. Credentials will be stored in root\'s keychain,')
  warn('not your user keychain. Consider reinstalling without sudo:')
  console.log()
  log('  npm install -g --prefix ~/.local @sweetpapatech/fam')
  console.log()
  log('Or use the install script with a user prefix:')
  console.log()
  log('  ./scripts/install.sh --prefix ~')
  console.log()
} else {
  log('FAM installed successfully.')
  console.log()
}

// Linux: check for libsecret (needed by @napi-rs/keyring)
if (plat === 'linux' && !isRoot) {
  // Check if secret service D-Bus interface is available
  let hasSecretService = false
  try {
    execSync(
      'dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.DBus.Peer.Ping',
      { stdio: 'ignore' },
    )
    hasSecretService = true
  } catch {
    // Try checking for the package directly
    hasSecretService = commandExists('secret-tool') || commandExists('gnome-keyring-daemon')
  }

  if (!hasSecretService) {
    warn('Secret service not detected. FAM needs it for credential storage.')
    log('Install with: sudo apt install gnome-keyring libsecret-tools')
    log('         or: sudo dnf install gnome-keyring libsecret')
    console.log()
  }
}

// ─── Get Started ────────────────────────────────────────────────

if (!isRoot) {
  log('Get started:')
  log('  fam init              # Create fam.yaml')
  log('  fam plan              # Preview changes')
  log('  fam apply             # Apply configuration')
  log('  fam daemon start      # Start the MCP proxy')
  console.log()
  log('Docs: https://github.com/Sweet-Papa-Technologies/FAM')
  console.log()
}
