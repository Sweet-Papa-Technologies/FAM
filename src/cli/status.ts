/**
 * cli/status.ts -- `fam status` command.
 *
 * Quick health overview.
 * Per DESIGN.md Section 6.9:
 *  1. Check daemon status (getDaemonStatus from lifecycle)
 *  2. Check config validity
 *  3. Print: daemon running/stopped, config valid/invalid,
 *     credential status, etc.
 */

import { Command } from 'commander'
import { resolve } from 'node:path'
import chalk from 'chalk'

import { parseConfig } from '../config/index.js'
import type { FamConfig } from '../config/index.js'
import { getDaemonStatus } from '../daemon/index.js'
import { KeychainVault } from '../vault/index.js'
import { FamError } from '../utils/errors.js'

// ---- Status components ------------------------------------------------------

interface StatusLine {
  label: string
  value: string
  color: 'green' | 'red' | 'yellow' | 'dim'
}

function getDaemonStatusLine(): StatusLine {
  const status = getDaemonStatus()
  if (!status || !status.running) {
    return { label: 'Daemon', value: 'stopped', color: 'red' }
  }
  const pidInfo = status.pid ? ` (PID ${status.pid})` : ''
  return { label: 'Daemon', value: `running${pidInfo}`, color: 'green' }
}

function getConfigStatusLine(configPath: string): { line: StatusLine; config: FamConfig | null } {
  try {
    const config = parseConfig(configPath)
    return {
      line: { label: 'Config', value: `${configPath} valid`, color: 'green' },
      config,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : 'unknown error'
    return {
      line: { label: 'Config', value: `invalid (${msg})`, color: 'red' },
      config: null,
    }
  }
}

async function getCredentialStatusLines(config: FamConfig): Promise<StatusLine[]> {
  const vault = new KeychainVault()
  const credNames = Object.keys(config.credentials)

  if (credNames.length === 0) {
    return [{ label: 'Credentials', value: 'none declared', color: 'dim' }]
  }

  let presentCount = 0
  const missing: string[] = []

  for (const name of credNames) {
    const exists = await vault.exists(name)
    if (exists) {
      presentCount++
    } else {
      missing.push(name)
    }
  }

  if (missing.length === 0) {
    return [{
      label: 'Credentials',
      value: `${presentCount}/${credNames.length} present`,
      color: 'green',
    }]
  }

  return [{
    label: 'Credentials',
    value: `${presentCount}/${credNames.length} present (missing: ${missing.join(', ')})`,
    color: 'yellow',
  }]
}

function getServerStatusLines(config: FamConfig): StatusLine[] {
  const serverCount = Object.keys(config.mcp_servers).length
  if (serverCount === 0) {
    return [{ label: 'Servers', value: 'none configured', color: 'dim' }]
  }

  // Without daemon, we can only report what's declared
  return [{
    label: 'Servers',
    value: `${serverCount} configured`,
    color: 'green',
  }]
}

function getProfileStatusLines(config: FamConfig): StatusLine[] {
  const profileNames = Object.keys(config.profiles)
  if (profileNames.length === 0) {
    return [{ label: 'Profiles', value: 'none configured', color: 'dim' }]
  }

  const summary = profileNames.join(', ')
  return [{
    label: 'Profiles',
    value: summary,
    color: 'green',
  }]
}

// ---- Formatting -------------------------------------------------------------

function formatStatusLine(line: StatusLine): string {
  const colors: Record<StatusLine['color'], (s: string) => string> = {
    green: chalk.green,
    red: chalk.red,
    yellow: chalk.yellow,
    dim: chalk.dim,
  }
  const colorFn = colors[line.color]
  const padding = ' '.repeat(Math.max(0, 16 - line.label.length))
  return `  ${chalk.bold(line.label + ':')}${padding}${colorFn(line.value)}`
}

// ---- Command ----------------------------------------------------------------

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Quick health overview')
    .action(async () => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const useJson = globalOpts.json === true

        const lines: StatusLine[] = []

        // 1. Daemon status
        lines.push(getDaemonStatusLine())

        // 2. Config status
        const { line: configLine, config } = getConfigStatusLine(configPath)
        lines.push(configLine)

        // 3. Credential, server, and profile status (only if config is valid)
        if (config) {
          const credLines = await getCredentialStatusLines(config)
          lines.push(...credLines)

          const serverLines = getServerStatusLines(config)
          lines.push(...serverLines)

          const profileLines = getProfileStatusLines(config)
          lines.push(...profileLines)
        }

        if (useJson) {
          const jsonOutput = lines.map((l) => ({
            label: l.label,
            value: l.value,
            status: l.color === 'green' ? 'ok' : l.color === 'red' ? 'error' : l.color,
          }))
          console.log(JSON.stringify(jsonOutput, null, 2))
        } else {
          console.log(chalk.bold('\nFAM Status\n'))
          for (const line of lines) {
            console.log(formatStatusLine(line))
          }
          console.log()
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
