/**
 * cli/drift.ts — Drift detection CLI command.
 *
 * Compares generated config files against their expected state
 * to detect unauthorized modifications. Supports JSON output
 * for CI integration and watch mode for continuous monitoring.
 */

import { Command } from 'commander'
import chalk from 'chalk'

import { detectDrift } from '../drift/index.js'
import { getFamDir } from '../utils/paths.js'

// ─── Command Registration ─────────────────────────────────────────

export function registerDriftCommand(program: Command): void {
  program
    .command('drift')
    .description('Detect configuration drift from last fam apply')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Watch for changes (poll every 5s)')
    .action(async (opts: { json?: boolean; watch?: boolean }) => {
      const famDir = getFamDir()

      const runCheck = () => {
        const report = detectDrift(famDir)

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2))
          return report
        }

        // Pretty print
        if (report.totalConfigs === 0) {
          console.log(chalk.yellow('No generated configs found. Run `fam apply` first.'))
          return report
        }

        console.log(chalk.dim(`Drift check at ${report.timestamp}\n`))

        for (const entry of report.entries) {
          const icon =
            entry.status === 'clean'
              ? chalk.green('\u2713')
              : entry.status === 'modified'
                ? chalk.yellow('\u26A0')
                : chalk.red('\u2717')

          const statusText =
            entry.status === 'clean'
              ? chalk.green('clean')
              : entry.status === 'modified'
                ? chalk.yellow('modified')
                : chalk.red('missing')

          console.log(`  ${icon} ${entry.name} -- ${statusText}`)
          console.log(chalk.dim(`    ${entry.path}`))

          if (entry.status === 'modified') {
            console.log(chalk.dim(`    expected: ${entry.expectedHash.substring(0, 12)}...`))
            console.log(chalk.dim(`    current:  ${entry.currentHash?.substring(0, 12)}...`))
          }
        }

        console.log()
        const summary = [
          `${report.totalConfigs} configs:`,
          report.clean > 0 ? chalk.green(`${report.clean} clean`) : null,
          report.modified > 0 ? chalk.yellow(`${report.modified} modified`) : null,
          report.missing > 0 ? chalk.red(`${report.missing} missing`) : null,
        ]
          .filter(Boolean)
          .join(', ')

        console.log(summary)

        if (!report.hasDrift) {
          console.log(chalk.green('\nNo drift detected.'))
        } else {
          console.log(chalk.yellow('\nDrift detected. Run `fam apply` to reconcile.'))
        }

        return report
      }

      if (opts.watch) {
        console.log(chalk.dim('Watching for drift (every 5s)... Press Ctrl+C to stop.\n'))
        // Run immediately
        runCheck()
        // Then poll
        const interval = setInterval(() => {
          console.log(chalk.dim('\n--- ' + new Date().toISOString() + ' ---\n'))
          runCheck()
        }, 5000)

        // Clean up on SIGINT
        process.on('SIGINT', () => {
          clearInterval(interval)
          process.exit(0)
        })

        // Keep alive -- never resolves, process runs until Ctrl+C
        await new Promise(() => {})
      } else {
        const report = runCheck()
        if (report.hasDrift) {
          process.exit(2) // Non-zero exit for CI usage
        }
      }
    })
}
