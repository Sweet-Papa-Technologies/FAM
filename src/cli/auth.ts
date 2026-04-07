/**
 * cli/auth.ts — OAuth2 authentication management commands.
 *
 * Subcommands: login, status, refresh, providers.
 * Manages the OAuth2 authorization_code flow for credentials
 * declared as type: oauth2 in fam.yaml.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { parseConfig } from '../config/index.js'
import { KeychainVault } from '../vault/index.js'
import { OAuthManager } from '../vault/oauth.js'
import { listProviders } from '../vault/oauth-providers.js'
import type { FamConfig } from '../config/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Load config and create vault + oauth manager.
 * Exits with error if config cannot be loaded.
 */
function loadDeps(configPath: string): {
  config: FamConfig
  vault: KeychainVault
  oauthManager: OAuthManager
} {
  const config = parseConfig(configPath)
  const vault = new KeychainVault()
  const oauthManager = new OAuthManager(vault, config)
  return { config, vault, oauthManager }
}

// ─── Command Registration ─────────────────────────────────────────────

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('OAuth2 authentication management')

  // ── fam auth login <credential> ─────────────────────────────────────

  auth
    .command('login <credential>')
    .description('Start OAuth2 authorization flow for a credential')
    .action(async (credName: string) => {
      try {
        const configPath = program.opts().config as string
        const { config, oauthManager } = loadDeps(configPath)

        // Verify credential exists and is OAuth2
        const credConfig = config.credentials[credName]
        if (!credConfig) {
          console.error(chalk.red(`Error: Credential '${credName}' not found in fam.yaml.`))
          process.exit(1)
        }

        if (credConfig.type !== 'oauth2') {
          console.error(
            chalk.red(
              `Error: Credential '${credName}' is type '${credConfig.type}', not 'oauth2'.`,
            ),
          )
          console.error(
            chalk.dim('Use "fam secret set" for API key credentials.'),
          )
          process.exit(1)
        }

        console.log(
          chalk.blue(
            `Starting OAuth2 flow for '${credName}' (provider: ${credConfig.provider})`,
          ),
        )
        console.log(chalk.dim('Your browser will open for authorization...'))

        await oauthManager.initiateFlow(credName)

        console.log(chalk.green(`OAuth2 tokens stored for '${credName}'.`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`OAuth login failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam auth status [credential] ────────────────────────────────────

  auth
    .command('status [credential]')
    .description('Show OAuth2 token status for credentials')
    .action(async (credName?: string) => {
      try {
        const configPath = program.opts().config as string
        const { config, oauthManager } = loadDeps(configPath)

        // Collect credentials to check
        const credNames: string[] = []
        if (credName) {
          credNames.push(credName)
        } else {
          // Show all OAuth2 credentials
          for (const [name, cred] of Object.entries(config.credentials)) {
            if (cred.type === 'oauth2') {
              credNames.push(name)
            }
          }
        }

        if (credNames.length === 0) {
          console.log(chalk.dim('No OAuth2 credentials found in fam.yaml.'))
          return
        }

        // Print header
        console.log(chalk.bold('OAuth2 Token Status'))
        console.log(chalk.dim('─'.repeat(60)))

        for (const name of credNames) {
          const credConfig = config.credentials[name]
          if (!credConfig || credConfig.type !== 'oauth2') {
            console.log(`${chalk.yellow(name)}  ${chalk.dim('not an oauth2 credential')}`)
            continue
          }

          const status = await oauthManager.getTokenStatus(name)

          const accessLabel = status.hasAccessToken
            ? chalk.green('stored')
            : chalk.red('missing')

          const refreshLabel = status.hasRefreshToken
            ? chalk.green('stored')
            : chalk.dim('none')

          let expiryLabel: string
          if (!status.expiresAt) {
            expiryLabel = chalk.dim('unknown')
          } else if (status.isExpired) {
            expiryLabel = chalk.red('expired')
          } else {
            const remaining = new Date(status.expiresAt).getTime() - Date.now()
            const minutes = Math.floor(remaining / 60_000)
            if (minutes < 60) {
              expiryLabel = chalk.yellow(`${minutes}m remaining`)
            } else {
              const hours = Math.floor(minutes / 60)
              expiryLabel = chalk.green(`${hours}h remaining`)
            }
          }

          console.log(
            `${chalk.bold(name)}  ` +
              `provider=${chalk.cyan(credConfig.provider)}  ` +
              `access=${accessLabel}  ` +
              `refresh=${refreshLabel}  ` +
              `expires=${expiryLabel}`,
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to check status: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam auth refresh <credential> ───────────────────────────────────

  auth
    .command('refresh <credential>')
    .description('Force-refresh an OAuth2 access token')
    .action(async (credName: string) => {
      try {
        const configPath = program.opts().config as string
        const { oauthManager } = loadDeps(configPath)

        console.log(chalk.blue(`Refreshing token for '${credName}'...`))

        await oauthManager.forceRefresh(credName)

        console.log(chalk.green(`Token refreshed for '${credName}'.`))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Token refresh failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── fam auth providers ──────────────────────────────────────────────

  auth
    .command('providers')
    .description('List supported OAuth2 providers')
    .action(() => {
      const providers = listProviders()

      console.log(chalk.bold('Supported OAuth2 Providers'))
      console.log(chalk.dim('─'.repeat(40)))

      for (const name of providers) {
        console.log(`  ${chalk.cyan(name)}`)
      }

      console.log()
      console.log(
        chalk.dim(
          'Configure a provider in fam.yaml under credentials with type: oauth2',
        ),
      )
    })
}
