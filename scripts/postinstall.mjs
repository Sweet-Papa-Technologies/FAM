#!/usr/bin/env node
/**
 * postinstall.mjs — Lightweight post-install hook for npm.
 *
 * Runs after `npm install -g @sweetpapatech/fam`.
 * Creates ~/.fam/ data directory and prints setup guidance.
 *
 * Design constraints:
 *   - NEVER exits non-zero (a failing postinstall blocks npm install)
 *   - Silent in CI environments
 *   - Silent for local (non-global) installs
 *   - Cross-platform (macOS, Linux, Windows)
 */

try {
  const { mkdirSync, chmodSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { homedir, platform } = await import('node:os')
  const { execSync } = await import('node:child_process')

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

  // Silent exit for non-global installs and CI
  if (!isGlobal || isCI) {
    process.exit(0)
  }

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const isSudo = !!process.env.SUDO_USER
  const plat = platform()

  function log(msg) { console.log(`  ${msg}`) }
  function warn(msg) { console.log(`  \u26A0 ${msg}`) }

  // ─── Create ~/.fam/ ─────────────────────────────────────────────

  try {
    const famDir = join(homedir(), '.fam')
    mkdirSync(famDir, { recursive: true })
    mkdirSync(join(famDir, 'configs'), { recursive: true })
    mkdirSync(join(famDir, 'instructions'), { recursive: true })

    if (plat !== 'win32') {
      try { chmodSync(famDir, 0o700) } catch { /* best effort */ }
    }

    if (isRoot && isSudo) {
      try {
        execSync(`chown -R ${process.env.SUDO_USER} ${famDir}`, { stdio: 'ignore' })
      } catch { /* best effort */ }
    }
  } catch { /* directory creation is best-effort */ }

  // ─── User Guidance ──────────────────────────────────────────────

  console.log()

  if (isRoot) {
    warn('FAM was installed as root. Credentials will be stored in root\'s keychain,')
    warn('not your user keychain. Consider reinstalling without sudo:')
    console.log()
    log('  npm install -g --prefix ~/.local @sweetpapatech/fam')
    console.log()
  } else {
    log('FAM installed successfully.')
    console.log()
    log('Get started:')
    log('  fam init              # Create fam.yaml')
    log('  fam plan              # Preview changes')
    log('  fam apply             # Apply configuration')
    log('  fam daemon start      # Start the MCP proxy')
    console.log()
    log('Docs: https://github.com/Sweet-Papa-Technologies/FAM')
    console.log()
  }

  // Linux: check for libsecret
  if (plat === 'linux' && !isRoot) {
    let hasSecretService = false
    try {
      execSync(
        'dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.DBus.Peer.Ping',
        { stdio: 'ignore' },
      )
      hasSecretService = true
    } catch {
      try {
        execSync('command -v secret-tool', { stdio: 'ignore' })
        hasSecretService = true
      } catch {
        try {
          execSync('command -v gnome-keyring-daemon', { stdio: 'ignore' })
          hasSecretService = true
        } catch { /* not found */ }
      }
    }

    if (!hasSecretService) {
      warn('Secret service not detected. FAM needs it for credential storage.')
      log('Install with: sudo apt install gnome-keyring libsecret-tools')
      console.log()
    }
  }

} catch {
  // NEVER fail the install. Postinstall is informational only.
}
