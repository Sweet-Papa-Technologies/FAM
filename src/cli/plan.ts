/**
 * cli/plan.ts -- `fam plan` command.
 *
 * Shows what `apply` would do without changing anything.
 * Per DESIGN.md Section 6.2:
 *  1. Parse and validate fam.yaml
 *  2. Load state.json (empty state if first run)
 *  3. Compute diff (desired vs current)
 *  4. Print formatted diff
 *  5. Print summary line
 *  6. Exit 0 if no changes, exit 2 if changes pending
 */

import { Command } from 'commander'
import { resolve } from 'node:path'
import chalk from 'chalk'

import { parseConfig, loadState, computeDiff, formatDiff } from '../config/index.js'
import { expandTilde } from '../config/index.js'
import { FamError } from '../utils/errors.js'
import type { PlanDiff } from '../config/index.js'

// ---- Helpers ----------------------------------------------------------------

/**
 * Colorize the raw formatDiff output.
 *
 * Lines starting with `  + ` get green, `  ~ ` get yellow, `  - ` get red.
 * Section headers and the summary line are bolded.
 */
function colorizePlan(raw: string, useColor: boolean): string {
  if (!useColor) return raw

  return raw
    .split('\n')
    .map((line) => {
      if (line.startsWith('  + ')) return chalk.green(line)
      if (line.startsWith('  ~ ')) return chalk.yellow(line)
      if (line.startsWith('  - ')) return chalk.red(line)
      if (line.endsWith(':')) return chalk.bold(line)
      if (line.startsWith('Plan:')) return chalk.bold(line)
      if (line.startsWith('No changes.')) return chalk.green(line)
      return line
    })
    .join('\n')
}

// ---- Shared plan logic (reused by apply) ------------------------------------

export interface PlanResult {
  diff: PlanDiff
  formatted: string
}

export function runPlan(configPath: string, famDir: string): PlanResult {
  const config = parseConfig(configPath)
  const state = loadState(famDir)
  const diff = computeDiff(config, state)
  const formatted = formatDiff(diff)
  return { diff, formatted }
}

// ---- Command ----------------------------------------------------------------

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Show what apply would do, without changing anything')
    .action(() => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const famDir = expandTilde(globalOpts.famDir as string ?? '~/.fam')
        const useColor = globalOpts.color !== false
        const useJson = globalOpts.json === true

        console.log(chalk.bold('\nFAM v0.1.0 -- Planning changes...\n'))

        const { diff, formatted } = runPlan(configPath, famDir)

        if (useJson) {
          console.log(JSON.stringify(diff, null, 2))
        } else {
          console.log(colorizePlan(formatted, useColor))
        }

        if (!diff.hasChanges) {
          console.log(
            chalk.green("\nFam's chillin'. Everything is up-to-date.\n"),
          )
          process.exit(0)
        }

        console.log(
          chalk.dim("\nFam's ready when you are. Run `fam apply` to execute.\n"),
        )
        process.exit(2)
      } catch (err) {
        if (err instanceof FamError) {
          console.error(chalk.red(`Error [${err.code}]:`) + ` ${err.message}`)
          process.exit(err.exitCode)
        }
        throw err
      }
    })
}
