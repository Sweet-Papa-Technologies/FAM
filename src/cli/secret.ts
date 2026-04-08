/**
 * cli/secret.ts — Manage credentials in the OS keychain.
 *
 * Subcommands: set, get, list, delete.
 * Based on DESIGN.md Section 6.5.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { password, confirm } from '@inquirer/prompts'
import { KeychainVault } from '../vault/index.js'
import { parseConfig } from '../config/index.js'
import type { FamConfig, CredentialConfig } from '../config/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Try to load fam.yaml to get declared credential names.
 * Returns null if the config cannot be loaded (non-fatal for secret ops).
 */
function tryLoadConfig(configPath: string): FamConfig | null {
  try {
    return parseConfig(configPath)
  } catch {
    return null
  }
}

/**
 * Format rotation status for a credential.
 */
function rotationLabel(cred: CredentialConfig | undefined, storedDate?: string): string {
  if (!cred) return chalk.dim('n/a')
  if (cred.type !== 'api_key' || !cred.rotate_after_days) return chalk.dim('none')

  if (!storedDate) return chalk.yellow('unknown')

  const setDate = new Date(storedDate)
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - setDate.getTime()) / (1000 * 60 * 60 * 24))
  const daysLeft = cred.rotate_after_days - daysSince

  if (daysLeft <= 0) return chalk.red(`overdue by ${Math.abs(daysLeft)}d`)
  if (daysLeft <= 7) return chalk.yellow(`${daysLeft}d remaining`)
  return chalk.green(`${daysLeft}d remaining`)
}

// ─── Command Registration ─────────────────────────────────────────────

export function registerSecretCommand(program: Command): void {
  const secret = program
    .command('secret')
    .description('Manage credentials in the OS keychain')

  // ── fam secret set <name> ──────────────────────────────────────────

  secret
    .command('set <name>')
    .description('Store a credential value in the OS keychain')
    .action(async (name: string) => {
      try {
        const vault = new KeychainVault()
        const configPath = program.opts().config as string | undefined

        // Prompt for value (hidden input)
        const value = await password({
          message: `Enter value for "${name}":`,
        })

        if (!value) {
          console.error(chalk.red('Error: Empty value provided. Aborting.'))
          process.exit(1)
        }

        await vault.set(name, value)
        console.log(chalk.green(`Secret "${name}" stored in OS keychain.`))

        // Warn if credential not declared in fam.yaml
        if (configPath) {
          const config = tryLoadConfig(configPath)
          if (config && !(name in config.credentials)) {
            console.log(
              chalk.yellow(
                `Warning: "${name}" is not declared in fam.yaml. ` +
                  'It will be stored but not used by FAM until added to the credentials section.',
              ),
            )
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to store secret: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam secret get <name> ──────────────────────────────────────────

  secret
    .command('get <name>')
    .description('Check if a credential exists and show a masked preview')
    .option('--yes', 'Skip safety confirmation (required for display)')
    .action(async (name: string, opts: { yes?: boolean }) => {
      try {
        if (!opts.yes) {
          console.error(
            chalk.red(
              'Error: --yes flag is required to display secret values.\n' +
                'This is a safety measure for shared terminals.\n' +
                'Usage: fam secret get <name> --yes',
            ),
          )
          process.exit(1)
        }

        const vault = new KeychainVault()
        const value = await vault.get(name)

        if (value === null) {
          console.error(chalk.red(`Secret "${name}" not found in OS keychain.`))
          process.exit(1)
        }

        // Always masked — FAM never exposes full credential values.
        // Use your OS keychain tool to retrieve full values:
        //   macOS:  security find-generic-password -s fam -a <name> -w
        //   Linux:  secret-tool lookup service fam username <name>
        const masked = value.length <= 6
          ? '*'.repeat(value.length)
          : value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2)
        console.log(`${name}: ${masked}`)
        console.log(chalk.dim('Full value available via your OS keychain (Keychain Access, secret-tool, etc.)'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to retrieve secret: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam secret list ────────────────────────────────────────────────

  secret
    .command('list')
    .description('List all declared credentials and their keychain status')
    .action(async () => {
      try {
        const configPath = program.opts().config as string | undefined
        let config: FamConfig | null = null

        if (configPath) {
          config = tryLoadConfig(configPath)
        }

        if (!config) {
          console.error(
            chalk.yellow(
              'Warning: Could not load fam.yaml. Cannot list declared credentials.\n' +
                'Run "fam init" to create a config, or specify --config <path>.',
            ),
          )
          process.exit(1)
        }

        const credentialNames = Object.keys(config.credentials)

        if (credentialNames.length === 0) {
          console.log(chalk.dim('No credentials declared in fam.yaml.'))
          return
        }

        const vault = new KeychainVault()
        const statuses = await vault.list(credentialNames)

        // Print table header
        const nameWidth = Math.max(
          'NAME'.length,
          ...statuses.map((s) => s.name.length),
        )
        const typeWidth = Math.max(
          'TYPE'.length,
          ...statuses.map((s) => {
            const cred = config.credentials[s.name]
            return cred ? cred.type.length : 0
          }),
        )

        const header = [
          'NAME'.padEnd(nameWidth),
          'TYPE'.padEnd(typeWidth),
          'STORED'.padEnd(8),
          'ROTATION',
        ].join('  ')

        console.log(chalk.bold(header))
        console.log(chalk.dim('─'.repeat(header.length + 10)))

        for (const status of statuses) {
          const cred = config.credentials[status.name]
          const credType = cred?.type ?? 'unknown'
          const stored = status.exists
            ? chalk.green('yes')
            : chalk.red('no')
          const rotation = rotationLabel(cred, status.lastSet)

          const row = [
            status.name.padEnd(nameWidth),
            credType.padEnd(typeWidth),
            stored.padEnd(8 + (stored.length - (status.exists ? 3 : 2))),
            rotation,
          ].join('  ')

          console.log(row)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to list secrets: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam secret delete <name> ───────────────────────────────────────

  secret
    .command('delete <name>')
    .description('Remove a credential from the OS keychain')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (name: string, opts: { yes?: boolean }) => {
      try {
        const vault = new KeychainVault()

        // Check if it exists first
        const exists = await vault.exists(name)
        if (!exists) {
          console.error(chalk.red(`Secret "${name}" not found in OS keychain.`))
          process.exit(1)
        }

        // Confirm deletion unless --yes
        if (!opts.yes) {
          const confirmed = await confirm({
            message: `Delete secret "${name}" from OS keychain?`,
            default: false,
          })

          if (!confirmed) {
            console.log(chalk.dim('Aborted.'))
            return
          }
        }

        await vault.delete(name)
        console.log(chalk.green(`Secret "${name}" deleted from OS keychain.`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to delete secret: ${msg}`))
        process.exit(1)
      }
    })
}
