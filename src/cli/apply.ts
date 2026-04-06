/**
 * cli/apply.ts -- `fam apply` command.
 *
 * Applies the declared configuration.
 * Per DESIGN.md Section 6.3:
 *  1. Run plan (same diff)
 *  2. If changes and not --yes, prompt for confirmation
 *  3. For new credentials: prompt for values, store via vault
 *  4. Generate session tokens for new profiles (needed before generators)
 *  5. Run generators (with I/O/S merge for first-time)
 *  6. Generate instruction files (FAM.md per profile)
 *  7. Write state.json
 *  8. If daemon running, POST /api/v1/reload
 *  9. Log config_change to audit
 * 10. Print summary
 */

import { Command } from 'commander'
import { resolve } from 'node:path'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import chalk from 'chalk'
import { confirm, select, password } from '@inquirer/prompts'

import {
  parseConfig,
  loadState,
  writeState,
  computeDiff,
  formatDiff,
  expandTilde,
} from '../config/index.js'
import type {
  FamConfig,
  State,
  PlanDiff,
  GeneratedConfigState,
  CredentialState,
  ProfileState,
  ServerState,
  HttpServerConfig,
  StdioServerConfig,
} from '../config/index.js'
import { KeychainVault } from '../vault/index.js'
import { AuditLogger } from '../audit/index.js'
import {
  generators as generatorRegistry,
  detectExistingConfig,
  applyMergeStrategy,
  generateInstructionFile,
} from '../generators/index.js'
import type { GeneratorOutput } from '../generators/index.js'
import { getDaemonStatus } from '../daemon/index.js'
import { generateToken, hashToken } from '../utils/crypto.js'
import { FamError } from '../utils/errors.js'
import { AUDIT_DB, SESSIONS_FILE } from '../utils/paths.js'

import type { SessionStore } from '../config/index.js'

// ---- Helpers ----------------------------------------------------------------

function isHttpServer(server: unknown): server is HttpServerConfig {
  return typeof server === 'object' && server !== null && 'url' in server
}

function isStdioServer(server: unknown): server is StdioServerConfig {
  return typeof server === 'object' && server !== null && 'command' in server
}

function hashString(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function loadSessionStore(): Promise<SessionStore> {
  const sessionsPath = SESSIONS_FILE
  if (!existsSync(sessionsPath)) {
    return { tokens: {} }
  }
  try {
    const { readFileSync } = await import('node:fs')
    const raw = readFileSync(sessionsPath, 'utf-8')
    return JSON.parse(raw) as SessionStore
  } catch {
    return { tokens: {} }
  }
}

function writeSessionStore(store: SessionStore): void {
  writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ---- Core apply logic -------------------------------------------------------

async function executeApply(
  config: FamConfig,
  diff: PlanDiff,
  famDir: string,
  currentState: State,
  dryRun: boolean,
): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

  const vault = new KeychainVault()

  // 3. New credentials: prompt for values, store via vault
  for (const item of diff.credentials.added) {
    if (dryRun) {
      console.log(chalk.dim(`  [dry-run] Would prompt for credential: ${item.name}`))
      created++
      continue
    }

    const value = await password({
      message: `Enter value for credential "${item.name}":`,
    })

    await vault.set(item.name, value)
    console.log(chalk.green(`  Stored credential: ${item.name}`))
    created++
  }

  // 4. Generate session tokens FIRST (needed by generators for config files)
  const sessions = await loadSessionStore()
  const newTokens: Array<{ profile: string; token: string }> = []
  const profileTokenMap: Record<string, string> = {}

  // Build a lookup of existing tokens: profile name → token value (from prior registrations)
  // For NEW profiles, generate tokens now so generators can embed them.
  for (const item of diff.profiles.added) {
    if (dryRun) {
      console.log(chalk.dim(`  [dry-run] Would generate session token for: ${item.name}`))
      profileTokenMap[item.name] = `fam_sk_dry_${'0'.repeat(64)}`
      created++
      continue
    }

    const token = generateToken(item.name)
    const tokenHash = hashToken(token)
    sessions.tokens[tokenHash] = {
      profile: item.name,
      created: new Date().toISOString(),
    }
    newTokens.push({ profile: item.name, token })
    profileTokenMap[item.name] = token
    created++
  }

  if (!dryRun && newTokens.length > 0) {
    writeSessionStore(sessions)
  }

  // For existing profiles, look up their token from prior registration.
  // We can't retrieve the raw token (only hash is stored), so we keep the
  // existing config content for unchanged profiles. If no token is available
  // (profile exists but was never registered), use a placeholder and warn.
  for (const [profileName] of Object.entries(config.profiles)) {
    if (!profileTokenMap[profileName]) {
      // Check if there's already a generated config — we'll preserve its content
      profileTokenMap[profileName] = `<run 'fam register ${profileName}' to generate a token>`
    }
  }

  // 5. Run generators (with I/O/S merge for first-time)
  const generatedConfigs: Record<string, GeneratedConfigState> = {
    ...currentState.generated_configs,
  }

  const processedGenerators = new Set<string>()

  for (const [_profileName, profile] of Object.entries(config.profiles)) {
    const genName = profile.config_target
    if (processedGenerators.has(genName)) continue
    processedGenerators.add(genName)

    const generator = config.generators[genName]
    if (!generator) continue

    const generatorFn = generatorRegistry[genName]
    if (!generatorFn) {
      console.log(chalk.yellow(`  Warning: No generator found for "${genName}"`))
      continue
    }

    const daemonUrl = `http://127.0.0.1:${config.settings.daemon.port}`

    const output: GeneratorOutput = generatorFn({
      profile: { ...profile, name: _profileName },
      settings: config.settings,
      sessionToken: profileTokenMap[_profileName] ?? '',
      daemonUrl,
    })

    const targetPath = expandTilde(generator.output)
    const isNew = !generatedConfigs[genName]

    if (isNew) {
      // Check for existing config and handle I/O/S
      const detection = detectExistingConfig(targetPath)

      if (detection.exists && !dryRun) {
        console.log(
          chalk.yellow(
            `\n  Existing config found at ${targetPath}`,
          ),
        )
        if (detection.servers && detection.servers.length > 0) {
          console.log(
            chalk.dim(
              `  Contains ${detection.servers.length} MCP server(s): ${detection.servers.map((s) => s.name).join(', ')}`,
            ),
          )
        }

        const strategy = await select({
          message: `How should FAM manage ${targetPath}?`,
          choices: [
            {
              name: 'Import & Manage -- Backup existing, let FAM control this file',
              value: 'import_and_manage' as const,
            },
            {
              name: 'Overwrite -- Backup existing, replace entirely with FAM config',
              value: 'overwrite' as const,
            },
            {
              name: 'Skip -- Leave this file alone',
              value: 'skip' as const,
            },
          ],
        })

        applyMergeStrategy(targetPath, output.content, strategy)
        generatedConfigs[genName] = {
          path: targetPath,
          last_written: new Date().toISOString(),
          content_hash: hashString(output.content),
          strategy,
        }

        if (strategy !== 'skip') {
          console.log(
            chalk.green(`  Wrote ${targetPath} (strategy: ${strategy})`),
          )
        } else {
          console.log(chalk.dim(`  Skipped ${targetPath}`))
        }
      } else if (!dryRun) {
        // No existing file -- write directly
        const dir = targetPath.substring(0, targetPath.lastIndexOf('/'))
        if (dir) mkdirSync(dir, { recursive: true })
        writeFileSync(targetPath, output.content, 'utf-8')
        generatedConfigs[genName] = {
          path: targetPath,
          last_written: new Date().toISOString(),
          content_hash: hashString(output.content),
          strategy: 'overwrite',
        }
        console.log(chalk.green(`  Created ${targetPath}`))
      }
      created++
    } else {
      // Subsequent run: upsert silently
      if (!dryRun) {
        const dir = targetPath.substring(0, targetPath.lastIndexOf('/'))
        if (dir) mkdirSync(dir, { recursive: true })
        writeFileSync(targetPath, output.content, 'utf-8')
        generatedConfigs[genName] = {
          ...generatedConfigs[genName],
          last_written: new Date().toISOString(),
          content_hash: hashString(output.content),
        }
        console.log(chalk.green(`  Updated ${targetPath}`))
      }
      updated++
    }
  }

  // 6. Generate instruction files (FAM.md per profile)
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    if (dryRun) continue

    const servers: Record<string, { description: string; tools: string[] }> = {}
    for (const serverName of profile.allowed_servers) {
      const server = config.mcp_servers[serverName]
      if (!server) continue
      servers[serverName] = {
        description: server.description,
        tools: [], // Tool discovery happens at daemon runtime
      }
    }

    const instructionsConfig = config.instructions
    const perProfile = instructionsConfig?.per_profile?.[profileName]

    const output = generateInstructionFile({
      profile: { ...profile, name: profileName },
      servers,
      nativeTools: Object.entries(config.native_tools)
        .filter(([_, t]) => t.enabled)
        .map(([name]) => `fam.${name}`),
      extraContext: perProfile?.extra_context,
      injectInto: perProfile?.inject_into,
    })

    const dir = output.path.substring(0, output.path.lastIndexOf('/'))
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(output.path, output.content, 'utf-8')
  }

  // 7. Write state.json
  if (!dryRun) {
    const newState: State = {
      version: '0.1',
      last_applied: new Date().toISOString(),
      applied_config_hash: hashString(JSON.stringify(config)),
      credentials: buildCredentialState(config, vault),
      mcp_servers: buildServerState(config),
      profiles: buildProfileState(config, sessions),
      generated_configs: generatedConfigs,
    }
    writeState(famDir, newState)
  }

  // 8. If daemon running, POST /api/v1/reload
  if (!dryRun) {
    const daemonStatus = getDaemonStatus()
    if (daemonStatus?.running) {
      try {
        const port = config.settings.daemon.port
        const resp = await fetch(`http://127.0.0.1:${port}/api/v1/reload`, {
          method: 'POST',
        })
        if (resp.ok) {
          console.log(chalk.green('  Daemon config reloaded'))
        } else {
          console.log(chalk.yellow('  Warning: Daemon reload returned non-OK status'))
        }
      } catch {
        console.log(chalk.yellow('  Warning: Could not reach daemon for reload'))
      }
    }
  }

  // 9. Log config_change to audit
  if (!dryRun) {
    try {
      const auditLogger = new AuditLogger(AUDIT_DB)
      await auditLogger.init()
      auditLogger.logConfigChange({
        action: 'apply',
        target: 'config',
        details: `${created} created, ${updated} updated`,
      })
      auditLogger.close()
    } catch {
      // Audit logging is best-effort -- don't fail the apply
    }
  }

  // Print new session tokens (they can only be shown once)
  if (newTokens.length > 0) {
    console.log(chalk.bold('\nNew session tokens (save these -- they cannot be retrieved):'))
    for (const { profile, token } of newTokens) {
      console.log(`  ${chalk.cyan(profile)}: ${token}`)
    }
  }

  return { created, updated }
}

// ---- State builders ---------------------------------------------------------

function buildCredentialState(
  config: FamConfig,
  _vault: KeychainVault,
): Record<string, CredentialState> {
  const state: Record<string, CredentialState> = {}
  for (const [name, cred] of Object.entries(config.credentials)) {
    state[name] = {
      type: cred.type,
      exists_in_keychain: true, // We just stored them during apply
      last_set: new Date().toISOString(),
      ...(cred.type === 'api_key' && cred.rotate_after_days
        ? { rotate_after_days: cred.rotate_after_days }
        : {}),
    }
  }
  return state
}

function buildServerState(config: FamConfig): Record<string, ServerState> {
  const state: Record<string, ServerState> = {}
  for (const [name, server] of Object.entries(config.mcp_servers)) {
    const base: ServerState = {
      transport: server.transport,
      credential: isHttpServer(server) ? server.credential : (server.credential ?? null),
      status: 'unknown',
      tools_discovered: [],
    }
    if (isHttpServer(server)) {
      base.url = server.url
    }
    if (isStdioServer(server)) {
      base.command = server.command
    }
    state[name] = base
  }
  return state
}

function buildProfileState(
  config: FamConfig,
  sessions: SessionStore,
): Record<string, ProfileState> {
  const state: Record<string, ProfileState> = {}

  // Build a reverse lookup: profile name -> token hash
  const profileToHash: Record<string, string> = {}
  for (const [hash, entry] of Object.entries(sessions.tokens)) {
    profileToHash[entry.profile] = hash
  }

  for (const [name, profile] of Object.entries(config.profiles)) {
    state[name] = {
      session_token_hash: profileToHash[name] ?? '',
      allowed_servers: profile.allowed_servers,
      tools_exposed_count: 0, // Updated when daemon discovers tools
    }
  }
  return state
}

// ---- Command ----------------------------------------------------------------

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Apply the declared configuration')
    .option('--yes', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(async (options: { yes?: boolean; dryRun?: boolean }) => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const famDir = expandTilde(globalOpts.famDir as string ?? '~/.fam')
        const useColor = globalOpts.color !== false

        console.log(chalk.bold('\nFAM v0.1.0 -- Applying configuration...\n'))

        // 1. Run plan
        const config = parseConfig(configPath)
        const currentState = loadState(famDir)
        const diff = computeDiff(config, currentState)
        const formatted = formatDiff(diff)

        // Print the plan
        const colorized = useColor
          ? formatted
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
          : formatted

        console.log(colorized)

        if (!diff.hasChanges) {
          console.log(chalk.green("\nNo changes to apply. Everything is up-to-date.\n"))
          process.exit(0)
        }

        // 2. Prompt for confirmation if not --yes
        if (!options.yes && !options.dryRun) {
          const proceed = await confirm({
            message: 'Do you want to apply these changes?',
            default: true,
          })

          if (!proceed) {
            console.log(chalk.yellow('\nApply cancelled.\n'))
            process.exit(2)
          }
        }

        if (options.dryRun) {
          console.log(chalk.dim('\n[dry-run] No changes were made.\n'))
        }

        console.log() // blank line before apply output

        // Ensure FAM directory exists
        mkdirSync(famDir, { recursive: true })

        // Execute
        const { created, updated } = await executeApply(
          config,
          diff,
          famDir,
          currentState,
          options.dryRun === true,
        )

        // 10. Print summary
        console.log(
          chalk.bold(
            `\nApply complete. ${created} resource(s) created, ${updated} updated.\n`,
          ),
        )

        process.exit(0)
      } catch (err) {
        if (err instanceof FamError) {
          console.error(chalk.red(`Error [${err.code}]:`) + ` ${err.message}`)
          process.exit(err.exitCode)
        }
        throw err
      }
    })
}
