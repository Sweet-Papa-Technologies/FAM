/**
 * cli/validate.ts -- `fam validate` command.
 *
 * Pre-apply validation.
 * Per DESIGN.md Section 6.8:
 *  1. Validate fam.yaml schema
 *  2. Check credentials exist in keychain
 *  3. Validate output paths are writable
 *  4. Check tool count limits (e.g., Cursor's 40-tool limit)
 *  5. Print pass/warn/fail checklist
 *  6. Exit 0 if all pass, 1 if any fail
 *
 * Network connectivity checks are skipped for MVP.
 */

import { Command } from 'commander'
import { resolve, dirname } from 'node:path'
import { accessSync, constants } from 'node:fs'
import chalk from 'chalk'

import { parseConfig, expandTilde } from '../config/index.js'
import type { FamConfig } from '../config/index.js'
import { KeychainVault } from '../vault/index.js'
import { FamError } from '../utils/errors.js'
import { validateOutputPath } from '../utils/paths.js'

// ---- Types ------------------------------------------------------------------

interface CheckResult {
  status: 'pass' | 'warn' | 'fail'
  label: string
  detail?: string
}

// ---- Checkers ---------------------------------------------------------------

function checkSchemaValid(configPath: string): CheckResult {
  try {
    parseConfig(configPath)
    return { status: 'pass', label: 'Config schema valid' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'fail', label: 'Config schema validation', detail: msg }
  }
}

async function checkCredentials(config: FamConfig): Promise<CheckResult[]> {
  const vault = new KeychainVault()
  const results: CheckResult[] = []

  const credNames = Object.keys(config.credentials)
  if (credNames.length === 0) {
    results.push({ status: 'pass', label: 'Credentials (none declared)' })
    return results
  }

  let missingCount = 0
  for (const name of credNames) {
    const exists = await vault.exists(name)
    if (exists) {
      results.push({ status: 'pass', label: `Credential: ${name}` })
    } else {
      results.push({
        status: 'fail',
        label: `Credential: ${name}`,
        detail: `Not found in keychain. Run: fam secret set ${name}`,
      })
      missingCount++
    }
  }

  if (missingCount > 0) {
    results.push({
      status: 'fail',
      label: `Credentials present`,
      detail: `${missingCount} of ${credNames.length} missing`,
    })
  } else {
    results.push({
      status: 'pass',
      label: `All ${credNames.length} credential(s) present in keychain`,
    })
  }

  return results
}

function checkOutputPaths(config: FamConfig): CheckResult[] {
  const results: CheckResult[] = []

  for (const [name, gen] of Object.entries(config.generators)) {
    const outputPath = expandTilde(gen.output)
    const dir = dirname(outputPath)

    // Path traversal / blocked-directory check
    try {
      validateOutputPath(gen.output)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ status: 'fail', label: `Output path safe: ${name}`, detail: msg })
      continue
    }

    try {
      accessSync(dir, constants.W_OK)
      results.push({ status: 'pass', label: `Output writable: ${name} (${outputPath})` })
    } catch {
      // Directory might not exist yet -- check parent
      try {
        const parentDir = dirname(dir)
        accessSync(parentDir, constants.W_OK)
        results.push({
          status: 'pass',
          label: `Output writable: ${name} (${outputPath})`,
          detail: 'Directory will be created',
        })
      } catch {
        results.push({
          status: 'fail',
          label: `Output writable: ${name}`,
          detail: `Cannot write to ${dir}`,
        })
      }
    }
  }

  return results
}

function checkToolLimits(config: FamConfig): CheckResult[] {
  const results: CheckResult[] = []

  // Known tool limits per config target
  const TOOL_LIMITS: Record<string, number> = {
    cursor: 40,
    cursor_mcp_config: 40,
  }

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const limit = TOOL_LIMITS[profile.config_target]
    if (!limit) continue

    // Count servers (each server exposes multiple tools, but we estimate)
    const serverCount = profile.allowed_servers.length
    // For now, use server count as a proxy for tool count
    // (Real tool count requires daemon discovery)
    if (serverCount > limit) {
      results.push({
        status: 'warn',
        label: `Tool limit: ${profileName}`,
        detail: `${serverCount} servers may exceed ${profile.config_target}'s ${limit}-tool limit`,
      })
    } else {
      results.push({
        status: 'pass',
        label: `Tool limit: ${profileName} (${serverCount} servers, limit ${limit})`,
      })
    }
  }

  return results
}

function checkModelCompatibility(config: FamConfig): CheckResult[] {
  const results: CheckResult[] = []

  // Per-target: which FAM provider types the tool actually supports natively
  const TARGET_COMPATIBILITY: Record<string, { allowed: Set<string>; label: string }> = {
    claude_code: { allowed: new Set(['anthropic', 'amazon_bedrock']), label: 'Claude Code (Anthropic models)' },
    claude_mcp_config: { allowed: new Set(['anthropic', 'amazon_bedrock']), label: 'Claude Code (Anthropic models)' },
    gemini_cli: { allowed: new Set(['google']), label: 'Gemini CLI (Google models only)' },
    gemini_mcp_config: { allowed: new Set(['google']), label: 'Gemini CLI (Google models only)' },
  }

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const compat = TARGET_COMPATIBILITY[profile.config_target]
    if (!compat) continue

    const modelRefs: string[] = []
    if (profile.model) modelRefs.push(profile.model)
    if (profile.model_roles) {
      modelRefs.push(...Object.values(profile.model_roles))
    }

    for (const ref of modelRefs) {
      const [providerName] = ref.split('/', 2)
      const provider = config.models[providerName]
      if (provider && !compat.allowed.has(provider.provider)) {
        results.push({
          status: 'warn',
          label: `Model compatibility: ${profileName}`,
          detail:
            `Uses "${provider.provider}" model with ${profile.config_target} target. ` +
            `${compat.label} — model config will be skipped.`,
        })
        break // One warning per profile is enough
      }
    }
  }

  return results
}

function checkProfileReferences(config: FamConfig): CheckResult[] {
  const results: CheckResult[] = []
  const serverNames = new Set(Object.keys(config.mcp_servers))

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const missingServers: string[] = []
    for (const serverName of profile.allowed_servers) {
      if (!serverNames.has(serverName)) {
        missingServers.push(serverName)
      }
    }

    if (missingServers.length > 0) {
      results.push({
        status: 'fail',
        label: `Profile references: ${profileName}`,
        detail: `References undefined server(s): ${missingServers.join(', ')}`,
      })
    } else {
      results.push({
        status: 'pass',
        label: `Profile references: ${profileName}`,
      })
    }
  }

  // Check generators referenced by profiles exist
  const generatorNames = new Set(Object.keys(config.generators))
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    if (!generatorNames.has(profile.config_target)) {
      results.push({
        status: 'warn',
        label: `Generator for profile: ${profileName}`,
        detail: `No generator found for config_target "${profile.config_target}"`,
      })
    }
  }

  // Check credential references in servers
  for (const [serverName, server] of Object.entries(config.mcp_servers)) {
    const credName = 'credential' in server ? (server.credential as string | null) : null
    if (credName && !config.credentials[credName]) {
      results.push({
        status: 'fail',
        label: `Server credential: ${serverName}`,
        detail: `References undefined credential "${credName}"`,
      })
    }
  }

  return results
}

// ---- Formatting -------------------------------------------------------------

function formatCheck(check: CheckResult): string {
  const icons: Record<CheckResult['status'], string> = {
    pass: chalk.green('PASS'),
    warn: chalk.yellow('WARN'),
    fail: chalk.red('FAIL'),
  }
  const icon = icons[check.status]
  const detail = check.detail ? chalk.dim(` -- ${check.detail}`) : ''
  return `  [${icon}] ${check.label}${detail}`
}

// ---- Command ----------------------------------------------------------------

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Pre-apply validation of fam.yaml')
    .action(async () => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const useJson = globalOpts.json === true

        console.log(chalk.bold('\nFAM -- Validating configuration...\n'))

        const allChecks: CheckResult[] = []

        // 1. Validate schema
        const schemaCheck = checkSchemaValid(configPath)
        allChecks.push(schemaCheck)

        if (schemaCheck.status === 'fail') {
          // If schema fails, we can't do further checks
          if (useJson) {
            console.log(JSON.stringify(allChecks, null, 2))
          } else {
            for (const check of allChecks) {
              console.log(formatCheck(check))
            }
          }
          console.log(chalk.red('\nValidation failed.\n'))
          process.exit(1)
        }

        const config = parseConfig(configPath)

        // 2. Check credentials
        const credChecks = await checkCredentials(config)
        allChecks.push(...credChecks)

        // 3. Check output paths
        const pathChecks = checkOutputPaths(config)
        allChecks.push(...pathChecks)

        // 4. Check tool count limits
        const limitChecks = checkToolLimits(config)
        allChecks.push(...limitChecks)

        // 5. Check profile references
        const refChecks = checkProfileReferences(config)
        allChecks.push(...refChecks)

        // 6. Check model compatibility
        const compatChecks = checkModelCompatibility(config)
        allChecks.push(...compatChecks)

        // Print results
        if (useJson) {
          console.log(JSON.stringify(allChecks, null, 2))
        } else {
          for (const check of allChecks) {
            console.log(formatCheck(check))
          }
        }

        // Summary
        const passes = allChecks.filter((c) => c.status === 'pass').length
        const warns = allChecks.filter((c) => c.status === 'warn').length
        const fails = allChecks.filter((c) => c.status === 'fail').length

        console.log()
        console.log(
          `  ${chalk.green(`${passes} passed`)}` +
            (warns > 0 ? `, ${chalk.yellow(`${warns} warning(s)`)}` : '') +
            (fails > 0 ? `, ${chalk.red(`${fails} failed`)}` : ''),
        )

        if (fails > 0) {
          console.log(chalk.red('\nValidation failed.\n'))
          process.exit(1)
        }

        if (warns > 0) {
          console.log(chalk.yellow('\nValidation passed with warnings.\n'))
        } else {
          console.log(chalk.green('\nAll checks passed.\n'))
        }

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
