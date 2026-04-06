/**
 * cli/daemon.ts — Manage the FAM daemon lifecycle.
 *
 * Subcommands: start, stop, restart, status.
 * Based on DESIGN.md Section 6.4.
 */

import { Command } from 'commander'
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

        if (!opts.foreground) {
          // MVP: Always run in foreground.
          // True background daemonization with TypeScript/ESM is complex
          // and will be added in a future release.
          console.log(
            chalk.yellow(
              'Note: Running in foreground. Use Ctrl+C to stop.\n' +
                'For background operation, use a process manager (launchd/systemd)\n' +
                'or run: nohup fam daemon start --foreground &',
            ),
          )
        }

        await startDaemon(config, { foreground: true }, { vault, audit })

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

        if (!opts.foreground) {
          console.log(
            chalk.yellow(
              'Note: Running in foreground. Use Ctrl+C to stop.\n' +
                'For background operation, use a process manager (launchd/systemd).',
            ),
          )
        }

        await startDaemon(config, { foreground: true }, { vault, audit })

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
}
