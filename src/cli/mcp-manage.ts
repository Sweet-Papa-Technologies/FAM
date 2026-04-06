/**
 * cli/mcp-manage.ts -- `fam mcp add|remove|list` commands.
 *
 * Quick-manage MCP servers without editing YAML.
 * Per DESIGN.md Section 6.7:
 *  - `fam mcp add <name>` with transport-specific options
 *  - `fam mcp remove <name>` with profile reference warnings
 *  - `fam mcp list` showing a formatted table
 *
 * These commands read, modify, and write fam.yaml directly.
 */

import { Command } from 'commander'
import { resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import chalk from 'chalk'

import { expandTilde } from '../config/index.js'
import { FamError, ConfigError } from '../utils/errors.js'

// ---- Types ------------------------------------------------------------------

interface McpServerYaml {
  url?: string
  command?: string
  args?: string[]
  transport: string
  credential?: string | null
  description?: string
  env?: Record<string, string>
  headers?: Record<string, string>
}

interface FamYaml {
  mcp_servers?: Record<string, McpServerYaml>
  profiles?: Record<string, { allowed_servers?: string[] }>
  [key: string]: unknown
}

// ---- Helpers ----------------------------------------------------------------

function loadYamlRaw(configPath: string): { content: string; parsed: FamYaml } {
  let content: string
  try {
    content = readFileSync(configPath, 'utf-8')
  } catch {
    throw new ConfigError('CONFIG_FILE_NOT_FOUND', `Cannot read: ${configPath}`)
  }

  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch {
    throw new ConfigError('CONFIG_YAML_PARSE_ERROR', `Invalid YAML in ${configPath}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ConfigError('CONFIG_VALIDATION_ERROR', `Config file is not a YAML object`)
  }

  return { content, parsed: parsed as FamYaml }
}

function saveYaml(configPath: string, data: FamYaml): void {
  const output = stringifyYaml(data, { lineWidth: 100 })
  writeFileSync(configPath, output, 'utf-8')
}

// ---- Commands ---------------------------------------------------------------

function registerAddCommand(mcp: Command, program: Command): void {
  mcp
    .command('add <name>')
    .description('Add an MCP server to fam.yaml')
    .requiredOption('--transport <type>', 'Transport type: sse, streamable_http, or stdio')
    .option('--url <url>', 'Server URL (for sse/streamable_http)')
    .option('--command <cmd>', 'Command to run (for stdio)')
    .option('--args <args...>', 'Arguments for the stdio command')
    .option('--credential <name>', 'Credential to bind')
    .option('--description <desc>', 'Server description')
    .action(
      (
        name: string,
        options: {
          transport: string
          url?: string
          command?: string
          args?: string[]
          credential?: string
          description?: string
        },
      ) => {
        try {
          const globalOpts = program.opts()
          const configPath = resolve(globalOpts.config as string ?? './fam.yaml')

          // Validate transport
          const validTransports = ['sse', 'streamable_http', 'stdio']
          if (!validTransports.includes(options.transport)) {
            console.error(
              chalk.red('Error:') +
                ` Invalid transport "${options.transport}". Must be one of: ${validTransports.join(', ')}`,
            )
            process.exit(1)
          }

          // Validate required options per transport
          if (options.transport === 'stdio') {
            if (!options.command) {
              console.error(
                chalk.red('Error:') + ' --command is required for stdio transport',
              )
              process.exit(1)
            }
          } else {
            if (!options.url) {
              console.error(
                chalk.red('Error:') +
                  ` --url is required for ${options.transport} transport`,
              )
              process.exit(1)
            }
          }

          const { parsed } = loadYamlRaw(configPath)

          if (!parsed.mcp_servers) {
            parsed.mcp_servers = {}
          }

          if (parsed.mcp_servers[name]) {
            console.error(
              chalk.red('Error:') + ` MCP server "${name}" already exists. Remove it first.`,
            )
            process.exit(1)
          }

          // Build server entry
          const serverEntry: McpServerYaml = {
            transport: options.transport,
            description: options.description ?? `${name} MCP server`,
          }

          if (options.transport === 'stdio') {
            serverEntry.command = options.command
            serverEntry.args = options.args ?? []
            serverEntry.credential = options.credential ?? null
          } else {
            serverEntry.url = options.url
            serverEntry.credential = options.credential ?? null
          }

          parsed.mcp_servers[name] = serverEntry
          saveYaml(configPath, parsed)

          console.log(chalk.green(`Added MCP server "${name}" to ${configPath}`))
          console.log(chalk.dim('Run `fam plan` to review changes.'))
        } catch (err) {
          if (err instanceof FamError) {
            console.error(chalk.red(`Error [${err.code}]:`) + ` ${err.message}`)
            process.exit(err.exitCode)
          }
          throw err
        }
      },
    )
}

function registerRemoveCommand(mcp: Command, program: Command): void {
  mcp
    .command('remove <name>')
    .description('Remove an MCP server from fam.yaml')
    .action((name: string) => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')

        const { parsed } = loadYamlRaw(configPath)

        if (!parsed.mcp_servers || !parsed.mcp_servers[name]) {
          console.error(
            chalk.red('Error:') + ` MCP server "${name}" not found in config.`,
          )
          process.exit(1)
        }

        // Check if any profiles reference this server
        const referencingProfiles: string[] = []
        if (parsed.profiles) {
          for (const [profileName, profile] of Object.entries(parsed.profiles)) {
            if (profile.allowed_servers?.includes(name)) {
              referencingProfiles.push(profileName)
            }
          }
        }

        if (referencingProfiles.length > 0) {
          console.log(
            chalk.yellow('Warning:') +
              ` The following profiles reference "${name}": ${referencingProfiles.join(', ')}`,
          )
          console.log(
            chalk.yellow(
              'These profiles will lose access to this server after removal.',
            ),
          )
        }

        delete parsed.mcp_servers[name]
        saveYaml(configPath, parsed)

        console.log(chalk.green(`Removed MCP server "${name}" from ${configPath}`))
        console.log(chalk.dim('Run `fam plan` to review changes.'))
      } catch (err) {
        if (err instanceof FamError) {
          console.error(chalk.red(`Error [${err.code}]:`) + ` ${err.message}`)
          process.exit(err.exitCode)
        }
        throw err
      }
    })
}

function registerListCommand(mcp: Command, program: Command): void {
  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(() => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const useJson = globalOpts.json === true

        const { parsed } = loadYamlRaw(configPath)

        const servers = parsed.mcp_servers ?? {}
        const entries = Object.entries(servers)

        if (entries.length === 0) {
          console.log(chalk.dim('No MCP servers configured.'))
          process.exit(0)
        }

        if (useJson) {
          console.log(JSON.stringify(servers, null, 2))
          process.exit(0)
        }

        // Print table
        console.log(chalk.bold('\nMCP Servers:\n'))

        // Header
        const nameWidth = Math.max(12, ...entries.map(([n]) => n.length)) + 2
        const transportWidth = 18
        const urlWidth = 50

        console.log(
          chalk.dim(
            '  ' +
              'Name'.padEnd(nameWidth) +
              'Transport'.padEnd(transportWidth) +
              'URL / Command'.padEnd(urlWidth) +
              'Credential',
          ),
        )
        console.log(
          chalk.dim(
            '  ' + '-'.repeat(nameWidth + transportWidth + urlWidth + 12),
          ),
        )

        for (const [name, server] of entries) {
          const transport = server.transport
          const endpoint =
            server.url ?? [server.command, ...(server.args ?? [])].join(' ')
          const credential = server.credential ?? chalk.dim('none')

          console.log(
            '  ' +
              chalk.cyan(name.padEnd(nameWidth)) +
              transport.padEnd(transportWidth) +
              (endpoint.length > urlWidth
                ? endpoint.slice(0, urlWidth - 3) + '...'
                : endpoint.padEnd(urlWidth)) +
              credential,
          )
        }

        console.log()
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

// ---- Register ---------------------------------------------------------------

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP servers in fam.yaml')

  registerAddCommand(mcp, program)
  registerRemoveCommand(mcp, program)
  registerListCommand(mcp, program)
}
