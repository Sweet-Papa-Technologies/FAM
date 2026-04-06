/**
 * cli/register.ts — Manage session tokens for tool profiles.
 *
 * Commands: register <profile>, --rotate, --revoke.
 * Based on DESIGN.md Section 6.6.
 */

import { readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { Command } from 'commander'
import chalk from 'chalk'
import { parseConfig } from '../config/index.js'
import type { SessionStore } from '../config/types.js'
import { generateToken, hashToken } from '../utils/crypto.js'
import { SESSIONS_FILE, ensureFamDir } from '../utils/paths.js'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Load the sessions.json file, returning an empty store if it doesn't exist.
 */
function loadSessions(): SessionStore {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const raw = readFileSync(SESSIONS_FILE, 'utf-8')
      return JSON.parse(raw) as SessionStore
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { tokens: {} }
}

/**
 * Write the sessions store to disk atomically.
 */
function writeSessions(store: SessionStore): void {
  ensureFamDir()
  writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  chmodSync(SESSIONS_FILE, 0o600)
}

/**
 * Find the token hash for a given profile in the sessions store.
 * Returns the hash string or null if not found.
 */
function findHashForProfile(store: SessionStore, profile: string): string | null {
  for (const [hash, entry] of Object.entries(store.tokens)) {
    if (entry.profile === profile) {
      return hash
    }
  }
  return null
}

// ─── Command Registration ─────────────────────────────────────────────

export function registerRegisterCommand(program: Command): void {
  program
    .command('register <profile>')
    .description('Manage session tokens for tool profiles')
    .option('--rotate', 'Rotate (replace) the existing token for this profile')
    .option('--revoke', 'Revoke the token for this profile')
    .action(async (profile: string, opts: { rotate?: boolean; revoke?: boolean }) => {
      try {
        const configPath = program.opts().config as string | undefined

        // Validate profile exists in fam.yaml
        if (configPath) {
          const config = parseConfig(configPath)
          if (!(profile in config.profiles)) {
            console.error(
              chalk.red(`Error: Profile "${profile}" not found in fam.yaml.`),
            )
            console.error(
              chalk.dim(
                `Available profiles: ${Object.keys(config.profiles).join(', ') || 'none'}`,
              ),
            )
            process.exit(1)
          }
        }

        // ── Revoke ────────────────────────────────────────────────

        if (opts.revoke) {
          const store = loadSessions()
          const existingHash = findHashForProfile(store, profile)

          if (!existingHash) {
            console.error(
              chalk.yellow(`No active token found for profile "${profile}".`),
            )
            process.exit(1)
          }

          delete store.tokens[existingHash]
          writeSessions(store)

          console.log(chalk.green(`Token for profile "${profile}" has been revoked.`))
          console.log(
            chalk.dim('The profile can no longer authenticate until a new token is registered.'),
          )
          return
        }

        // ── Rotate ────────────────────────────────────────────────

        if (opts.rotate) {
          const store = loadSessions()
          const existingHash = findHashForProfile(store, profile)

          if (existingHash) {
            delete store.tokens[existingHash]
          }

          const token = generateToken(profile)
          const hash = hashToken(token)

          store.tokens[hash] = {
            profile,
            created: new Date().toISOString(),
          }

          writeSessions(store)

          console.log(chalk.green(`Token rotated for profile "${profile}".`))
          if (existingHash) {
            console.log(chalk.dim('Previous token has been invalidated.'))
          }
          console.log()
          console.log(chalk.bold('New session token:'))
          console.log(chalk.cyan(token))
          console.log()
          console.log(
            chalk.yellow('WARNING: This token will not be shown again.'),
          )
          console.log(
            chalk.dim(
              `Add it to your agent's MCP config as a Bearer token header:\n` +
                `  "Authorization": "Bearer ${token}"`,
            ),
          )
          return
        }

        // ── Register (new token) ──────────────────────────────────

        const store = loadSessions()
        const existingHash = findHashForProfile(store, profile)

        if (existingHash) {
          console.error(
            chalk.yellow(
              `Profile "${profile}" already has an active token.\n` +
                'Use --rotate to generate a new one, or --revoke to remove it.',
            ),
          )
          process.exit(1)
        }

        const token = generateToken(profile)
        const hash = hashToken(token)

        store.tokens[hash] = {
          profile,
          created: new Date().toISOString(),
        }

        writeSessions(store)

        console.log(chalk.green(`Token registered for profile "${profile}".`))
        console.log()
        console.log(chalk.bold('Session token:'))
        console.log(chalk.cyan(token))
        console.log()
        console.log(
          chalk.yellow('WARNING: This token will not be shown again.'),
        )
        console.log(
          chalk.dim(
            `Add it to your agent's MCP config as a Bearer token header:\n` +
              `  "Authorization": "Bearer ${token}"`,
          ),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(chalk.red(`Failed to register token: ${msg}`))
        process.exit(1)
      }
    })
}
