/**
 * cli/daemon.ts — Manage the FAM daemon lifecycle.
 *
 * Subcommands: start, stop, restart, status.
 * Based on DESIGN.md Section 6.4.
 */

import { Command } from 'commander'
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { platform, homedir } from 'node:os'
import chalk from 'chalk'
import { parseConfig } from '../config/index.js'
import { KeychainVault } from '../vault/index.js'
import { AuditLogger } from '../audit/index.js'
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
} from '../daemon/index.js'
import { AUDIT_DB } from '../utils/paths.js'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Format uptime from milliseconds into a human-readable string.
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

// ─── Command Registration ─────────────────────────────────────────────

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('Manage the FAM daemon lifecycle')

  // ── fam daemon start ───────────────────────────────────────────────

  daemon
    .command('start')
    .description('Start the FAM daemon')
    .option('--foreground', 'Run in foreground (stay attached, log to stdout)')
    .action(async (opts: { foreground?: boolean }) => {
      try {
        const configPath = program.opts().config as string
        const config = parseConfig(configPath)

        const vault = new KeychainVault()
        const audit = new AuditLogger(AUDIT_DB)
        await audit.init()

        const port = config.settings.daemon.port

        console.log(chalk.dim(`Starting FAM daemon on port ${port}...`))

        await startDaemon(config, { foreground: opts.foreground ?? false }, { vault, audit, configPath })

        // startDaemon blocks in foreground mode; this line is reached
        // only if it exits or the mode is non-foreground.
        console.log(chalk.green(`FAM daemon started on port ${port}.`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to start daemon: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam daemon stop ────────────────────────────────────────────────

  daemon
    .command('stop')
    .description('Stop the running FAM daemon')
    .action(async () => {
      try {
        await stopDaemon()
        console.log(chalk.green('FAM daemon stopped.'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not running') || msg.includes('No PID file')) {
          console.log(chalk.yellow('Daemon is not running.'))
          process.exit(3)
        }
        console.error(chalk.red(`Failed to stop daemon: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam daemon restart ─────────────────────────────────────────────

  daemon
    .command('restart')
    .description('Restart the FAM daemon (stop then start)')
    .option('--foreground', 'Run in foreground after restart')
    .action(async (opts: { foreground?: boolean }) => {
      try {
        // Stop (ignore errors if not running)
        try {
          await stopDaemon()
          console.log(chalk.dim('Daemon stopped.'))
        } catch {
          console.log(chalk.dim('Daemon was not running.'))
        }

        // Start
        const configPath = program.opts().config as string
        const config = parseConfig(configPath)

        const vault = new KeychainVault()
        const audit = new AuditLogger(AUDIT_DB)
        await audit.init()

        const port = config.settings.daemon.port

        console.log(chalk.dim(`Restarting FAM daemon on port ${port}...`))

        await startDaemon(config, { foreground: opts.foreground ?? false }, { vault, audit, configPath })

        console.log(chalk.green(`FAM daemon restarted on port ${port}.`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to restart daemon: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam daemon status ──────────────────────────────────────────────

  daemon
    .command('status')
    .description('Show the daemon status')
    .action(() => {
      try {
        const status = getDaemonStatus()

        if (!status || !status.running) {
          console.log(chalk.yellow('Daemon: stopped'))
          process.exit(3)
        }

        console.log(chalk.green('Daemon: running'))

        if (status.pid !== undefined) {
          console.log(`  PID:    ${status.pid}`)
        }

        if (status.uptime !== undefined) {
          console.log(`  Uptime: ${formatUptime(status.uptime)}`)
        }

        if (status.port !== undefined) {
          console.log(`  Port:   ${status.port}`)
        }

        if (status.servers) {
          const serverEntries = Object.entries(status.servers)
          console.log(`  Servers: ${serverEntries.length}`)
          for (const [name, info] of serverEntries) {
            const statusColor = info.status === 'healthy'
              ? chalk.green(info.status)
              : chalk.yellow(info.status)
            console.log(`    ${name}: ${statusColor} (${info.toolCount} tools)`)
          }
        }

        if (status.profiles && status.profiles.length > 0) {
          console.log(`  Profiles: ${status.profiles.join(', ')}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to get daemon status: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam daemon install ─────────────────────────────────────────────

  daemon
    .command('install')
    .description('Install auto-start configuration (launchd on macOS, systemd on Linux)')
    .action(() => {
      try {
        const os = platform()
        const famBin = resolve(process.argv[1] ?? 'fam')
        const configPath = resolve(program.opts().config as string ?? './fam.yaml')

        if (os === 'darwin') {
          const plistDir = resolve(homedir(), 'Library/LaunchAgents')
          const plistPath = resolve(plistDir, 'com.sweetpapatech.fam.plist')

          const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sweetpapatech.fam</string>
  <key>ProgramArguments</key>
  <array>
    <string>${famBin}</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--config</string>
    <string>${configPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${homedir()}/.fam/daemon.log</string>
  <key>StandardErrorPath</key><string>${homedir()}/.fam/daemon.err</string>
</dict>
</plist>
`
          mkdirSync(plistDir, { recursive: true })
          writeFileSync(plistPath, plist, 'utf-8')
          console.log(chalk.green(`Wrote ${plistPath}`))
          console.log(chalk.dim(`  Load:   launchctl load ${plistPath}`))
          console.log(chalk.dim(`  Unload: launchctl unload ${plistPath}`))

        } else if (os === 'linux') {
          const unitDir = resolve(homedir(), '.config/systemd/user')
          const unitPath = resolve(unitDir, 'fam.service')

          const unit = `[Unit]
Description=FAM - FoFo Agent Manager Daemon
After=network.target

[Service]
ExecStart=${famBin} daemon start --foreground --config ${configPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
          mkdirSync(unitDir, { recursive: true })
          writeFileSync(unitPath, unit, 'utf-8')
          console.log(chalk.green(`Wrote ${unitPath}`))
          console.log(chalk.dim('  Enable: systemctl --user enable fam'))
          console.log(chalk.dim('  Start:  systemctl --user start fam'))
          console.log(chalk.dim('  Status: systemctl --user status fam'))

        } else {
          console.log(chalk.yellow(`Auto-start not supported on ${os}. Use your OS process manager manually.`))
          process.exit(1)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to install: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam daemon uninstall ───────────────────────────────────────────

  daemon
    .command('uninstall')
    .description('Remove auto-start configuration')
    .action(() => {
      try {
        const os = platform()

        if (os === 'darwin') {
          const plistPath = resolve(homedir(), 'Library/LaunchAgents/com.sweetpapatech.fam.plist')
          if (existsSync(plistPath)) {
            unlinkSync(plistPath)
            console.log(chalk.green(`Removed ${plistPath}`))
            console.log(chalk.dim('Run `launchctl unload` first if the agent is loaded.'))
          } else {
            console.log(chalk.yellow('No launchd plist found.'))
          }
        } else if (os === 'linux') {
          const unitPath = resolve(homedir(), '.config/systemd/user/fam.service')
          if (existsSync(unitPath)) {
            unlinkSync(unitPath)
            console.log(chalk.green(`Removed ${unitPath}`))
            console.log(chalk.dim('Run `systemctl --user disable fam` first if enabled.'))
          } else {
            console.log(chalk.yellow('No systemd unit found.'))
          }
        } else {
          console.log(chalk.yellow(`Not supported on ${os}.`))
          process.exit(1)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to uninstall: ${msg}`))
        process.exit(1)
      }
    })
}
