/**
 * cli/log.ts — Query and export the FAM audit log.
 *
 * Commands: log [options], log export.
 * Based on DESIGN.md Section 6.10.
 */

import { writeFileSync } from 'node:fs'
import { Command } from 'commander'
import chalk from 'chalk'
import { AuditLogger } from '../audit/index.js'
import type { AuditFilters, AuditEntry, McpCallEntry } from '../audit/types.js'
import { AUDIT_DB } from '../utils/paths.js'

// ─── Type Guard ───────────────────────────────────────────────────────

function isMcpCallEntry(
  entry: AuditEntry,
): entry is { id: number; timestamp: string } & McpCallEntry {
  return 'profile' in entry && 'toolName' in entry
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Colorize a status string for terminal output.
 */
function colorStatus(status: string): string {
  switch (status) {
    case 'success':
      return chalk.green(status)
    case 'error':
      return chalk.red(status)
    case 'denied':
      return chalk.red(status)
    case 'timeout':
      return chalk.yellow(status)
    default:
      return status
  }
}

/**
 * Format a latency value for display.
 */
function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return chalk.dim('--')
  if (ms < 100) return chalk.green(`${ms}ms`)
  if (ms < 1000) return chalk.yellow(`${ms}ms`)
  return chalk.red(`${ms}ms`)
}

/**
 * Truncate a string to a max width, adding ellipsis if needed.
 */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '\u2026'
}

/**
 * Build AuditFilters from CLI options.
 */
function buildFilters(opts: LogOptions): AuditFilters {
  const filters: AuditFilters = {}

  if (opts.profile) filters.profile = opts.profile
  if (opts.server) filters.serverNs = opts.server
  if (opts.since) filters.since = opts.since
  if (opts.status) filters.status = opts.status
  if (opts.limit !== undefined) filters.limit = opts.limit

  return filters
}

/**
 * Print audit entries as a formatted table.
 */
function printTable(entries: AuditEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.dim('No log entries found matching the specified filters.'))
    return
  }

  // Column widths
  const tsWidth = 19
  const profileWidth = 14
  const serverWidth = 14
  const toolWidth = 24
  const statusWidth = 8
  const latencyWidth = 8

  // Header
  const header = [
    'TIMESTAMP'.padEnd(tsWidth),
    'PROFILE'.padEnd(profileWidth),
    'SERVER'.padEnd(serverWidth),
    'TOOL'.padEnd(toolWidth),
    'STATUS'.padEnd(statusWidth),
    'LATENCY'.padStart(latencyWidth),
  ].join('  ')

  console.log(chalk.bold(header))
  console.log(chalk.dim('─'.repeat(header.length + 4)))

  // Rows
  for (const entry of entries) {
    if (!isMcpCallEntry(entry)) continue

    const ts = truncate(entry.timestamp, tsWidth).padEnd(tsWidth)
    const profile = truncate(entry.profile, profileWidth).padEnd(profileWidth)
    const server = truncate(entry.serverNs, serverWidth).padEnd(serverWidth)
    const tool = truncate(entry.toolName, toolWidth).padEnd(toolWidth)
    const status = colorStatus(entry.status)
    const statusPad = entry.status.padEnd(statusWidth)
    const latency = formatLatency(entry.latencyMs)

    // Use raw status length for padding, then overlay color
    const row = [
      ts,
      profile,
      server,
      tool,
      status + ' '.repeat(Math.max(0, statusWidth - statusPad.length + (statusPad.length - entry.status.length))),
      latency,
    ].join('  ')

    console.log(row)
  }

  console.log(chalk.dim(`\n${entries.filter(isMcpCallEntry).length} entries shown.`))
}

// ─── Option Types ─────────────────────────────────────────────────────

interface LogOptions {
  profile?: string
  server?: string
  since?: string
  limit?: number
  status?: string
}

interface ExportOptions {
  format: 'json' | 'csv'
  since?: string
  output?: string
  profile?: string
  server?: string
  limit?: number
  status?: string
}

// ─── Command Registration ─────────────────────────────────────────────

export function registerLogCommand(program: Command): void {
  const log = program
    .command('log')
    .description('Query the audit log')
    .option('--profile <name>', 'Filter by profile name')
    .option('--server <ns>', 'Filter by server namespace')
    .option('--since <duration>', 'Time window: 1h, 24h, 7d, 30d')
    .option('--limit <n>', 'Max results (default: 50)', (val) => parseInt(val, 10))
    .option('--status <status>', 'Filter by status: success, error, denied, timeout')
    .action((opts: LogOptions) => {
      try {
        const audit = new AuditLogger(AUDIT_DB)
        audit.init().then(() => {
          try {
            const filters = buildFilters(opts)
            const entries = audit.query(filters)
            printTable(entries)
          } finally {
            audit.close()
          }
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(chalk.red(`Failed to query audit log: ${msg}`))
          process.exit(1)
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to query audit log: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam log export ─────────────────────────────────────────────────

  log
    .command('export')
    .description('Export the audit log to a file or stdout')
    .option('--format <format>', 'Export format: json or csv', 'json')
    .option('--since <duration>', 'Time window: 1h, 24h, 7d, 30d')
    .option('--output <path>', 'Output file path (stdout if not specified)')
    .option('--profile <name>', 'Filter by profile name')
    .option('--server <ns>', 'Filter by server namespace')
    .option('--limit <n>', 'Max results', (val) => parseInt(val, 10))
    .option('--status <status>', 'Filter by status')
    .action((opts: ExportOptions) => {
      try {
        // Validate format
        if (opts.format !== 'json' && opts.format !== 'csv') {
          console.error(
            chalk.red(`Invalid format "${opts.format}". Use "json" or "csv".`),
          )
          process.exit(1)
        }

        const audit = new AuditLogger(AUDIT_DB)
        audit.init().then(() => {
          try {
            const filters = buildFilters(opts)
            const output = audit.export(opts.format, filters)

            if (opts.output) {
              writeFileSync(opts.output, output, 'utf-8')
              console.log(
                chalk.green(`Audit log exported to ${opts.output} (${opts.format} format).`),
              )
            } else {
              // Write to stdout
              process.stdout.write(output + '\n')
            }
          } finally {
            audit.close()
          }
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(chalk.red(`Failed to export audit log: ${msg}`))
          process.exit(1)
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to export audit log: ${msg}`))
        process.exit(1)
      }
    })
}
