/**
 * cli/init.ts -- `fam init` command.
 *
 * Creates a new fam.yaml with interactive prompts.
 * Per DESIGN.md Section 6.1:
 *  1. Check if fam.yaml exists (warn/exit unless --force)
 *  2. Prompt: "Which tools do you use?" (multi-select)
 *  3. Scan for existing MCP configs
 *  4. Offer to import found configs
 *  5. Write fam.yaml scaffold
 *  6. Create ~/.fam/ directory
 *  7. Print next steps
 */

import { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import chalk from 'chalk'
import { checkbox, confirm } from '@inquirer/prompts'

import { expandTilde } from '../config/index.js'
import { FamError } from '../utils/errors.js'

// ---- Types ------------------------------------------------------------------

interface ToolChoice {
  name: string
  value: string
  configPaths: string[]
}

interface DiscoveredServer {
  name: string
  config: Record<string, unknown>
  source: string
}

// ---- Constants --------------------------------------------------------------

const TOOL_CHOICES: ToolChoice[] = [
  {
    name: 'Claude Code',
    value: 'claude_code',
    configPaths: ['~/.config/claude/claude_desktop_config.json', '~/.claude/settings.json'],
  },
  {
    name: 'Cursor',
    value: 'cursor',
    configPaths: ['~/.cursor/mcp.json'],
  },
  {
    name: 'VS Code (Copilot)',
    value: 'vscode',
    configPaths: ['.vscode/mcp.json'],
  },
  {
    name: 'Windsurf',
    value: 'windsurf',
    configPaths: ['~/.codeium/windsurf/mcp_config.json'],
  },
  {
    name: 'Zed',
    value: 'zed',
    configPaths: ['~/Library/Application Support/Zed/settings.json', '~/.config/zed/settings.json'],
  },
  {
    name: 'Cline (VS Code extension)',
    value: 'cline',
    configPaths: ['cline_mcp_settings.json'],
  },
  {
    name: 'Roo Code',
    value: 'roo_code',
    configPaths: ['.roo/mcp.json'],
  },
  {
    name: 'OpenCode',
    value: 'opencode',
    configPaths: ['~/.config/opencode/opencode.json'],
  },
  {
    name: 'OpenHands',
    value: 'openhands',
    configPaths: [],
  },
  {
    name: 'Gemini CLI',
    value: 'gemini_cli',
    configPaths: ['~/.gemini/settings.json'],
  },
  {
    name: 'GitHub Copilot CLI',
    value: 'github_copilot',
    configPaths: ['~/.copilot/mcp-config.json'],
  },
  {
    name: 'Amazon Q',
    value: 'amazon_q',
    configPaths: ['~/.aws/amazonq/agents/default.json'],
  },
]

// ---- Generator Defaults (output path + format per tool) ---------------------

const GENERATOR_DEFAULTS: Record<string, { output: string; format: string }> = {
  claude_code:    { output: '~/.claude/settings.json', format: 'claude_mcp_config' },
  cursor:         { output: '~/.cursor/mcp.json', format: 'cursor_mcp_config' },
  vscode:         { output: '.vscode/mcp.json', format: 'vscode_mcp_config' },
  windsurf:       { output: '~/.codeium/windsurf/mcp_config.json', format: 'windsurf_mcp_config' },
  zed:            { output: '~/Library/Application Support/Zed/settings.json', format: 'zed_config' },
  cline:          { output: 'cline_mcp_settings.json', format: 'cline_mcp_config' },
  roo_code:       { output: '.roo/mcp.json', format: 'roo_code_mcp_config' },
  opencode:       { output: '~/.config/opencode/opencode.json', format: 'opencode_config' },
  openhands:      { output: '~/.fam/configs/openhands.json', format: 'openhands_config' },
  gemini_cli:     { output: '~/.gemini/settings.json', format: 'gemini_mcp_config' },
  github_copilot: { output: '~/.copilot/mcp-config.json', format: 'github_copilot_mcp_config' },
  amazon_q:       { output: '~/.aws/amazonq/agents/default.json', format: 'amazon_q_config' },
}

// ---- Helpers ----------------------------------------------------------------

function scanForExistingConfigs(tools: string[]): DiscoveredServer[] {
  const discovered: DiscoveredServer[] = []

  for (const tool of tools) {
    const choice = TOOL_CHOICES.find((t) => t.value === tool)
    if (!choice) continue

    for (const rawPath of choice.configPaths) {
      const absPath = expandTilde(rawPath)
      if (!existsSync(absPath)) continue

      try {
        const raw = readFileSync(absPath, 'utf-8')
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) continue

        const obj = parsed as Record<string, unknown>

        // Claude Code / Cursor format: { mcpServers: { ... } }
        const mcpServers = obj['mcpServers'] as Record<string, unknown> | undefined
        if (mcpServers && typeof mcpServers === 'object') {
          for (const [name, config] of Object.entries(mcpServers)) {
            discovered.push({
              name,
              config: config as Record<string, unknown>,
              source: rawPath,
            })
          }
        }

        // VS Code format: { servers: { ... } }
        const servers = obj['servers'] as Record<string, unknown> | undefined
        if (servers && typeof servers === 'object') {
          for (const [name, config] of Object.entries(servers)) {
            discovered.push({
              name,
              config: config as Record<string, unknown>,
              source: rawPath,
            })
          }
        }
      } catch {
        // File not parseable -- skip silently
      }
    }
  }

  return discovered
}

function buildScaffold(
  tools: string[],
  importedServers: DiscoveredServer[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    version: '1.0',
  }

  // Settings
  config['settings'] = {
    daemon: {
      port: 7865,
      socket: '~/.fam/agent.sock',
      auto_start: true,
    },
    audit: {
      enabled: true,
      retention_days: 90,
      export_format: 'json',
    },
  }

  // Credentials placeholder
  config['credentials'] = {}

  // MCP servers from imports
  const mcpServers: Record<string, unknown> = {}
  for (const server of importedServers) {
    const serverConfig = server.config
    if (typeof serverConfig === 'object' && serverConfig !== null) {
      const sc = serverConfig as Record<string, unknown>
      if (sc['command']) {
        // stdio server
        mcpServers[server.name] = {
          command: sc['command'],
          args: sc['args'] ?? [],
          transport: 'stdio',
          credential: null,
          description: `Imported from ${server.source}`,
        }
      } else if (sc['url']) {
        // HTTP server
        mcpServers[server.name] = {
          url: sc['url'],
          transport: sc['transport'] ?? 'sse',
          credential: null,
          description: `Imported from ${server.source}`,
        }
      }
    }
  }
  config['mcp_servers'] = mcpServers

  // Profiles from selected tools
  const profiles: Record<string, unknown> = {}
  const generators: Record<string, unknown> = {}
  const serverNames = Object.keys(mcpServers)

  for (const tool of tools) {
    const choice = TOOL_CHOICES.find((t) => t.value === tool)
    if (!choice) continue

    profiles[choice.value] = {
      description: `${choice.name} profile`,
      config_target: choice.value,
      allowed_servers: serverNames,
      denied_servers: [],
    }

    // Set up generators — look up default output path from the registry
    const genConfig = GENERATOR_DEFAULTS[choice.value]
    if (genConfig) {
      generators[choice.value] = {
        output: genConfig.output,
        format: genConfig.format,
      }
    }
  }

  config['profiles'] = profiles
  config['generators'] = generators

  // Native tools
  config['native_tools'] = {
    whoami: { enabled: true, description: 'Check your profile and permissions' },
    log_action: { enabled: true, description: 'Report significant actions for audit trail' },
    list_servers: { enabled: true, description: 'List available MCP servers' },
    health: { enabled: true, description: 'Check daemon and server status' },
    get_knowledge: { enabled: true, description: 'Retrieve a knowledge entry by key' },
    set_knowledge: { enabled: true, description: 'Store a knowledge entry' },
    search_knowledge: { enabled: true, description: 'Full-text search across knowledge entries' },
    get_audit_log: { enabled: true, description: 'Query the audit trail' },
    list_profiles: { enabled: true, description: 'List all configured profiles' },
  }

  // Instructions
  config['instructions'] = {
    enabled: true,
    output_dir: '~/.fam/instructions',
  }

  return config
}

// ---- Command ----------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create a new fam.yaml with interactive prompts')
    .option('--dir <path>', 'Directory to create fam.yaml in', '.')
    .option('--force', 'Overwrite existing fam.yaml')
    .action(async (options: { dir: string; force?: boolean }) => {
      try {
        const targetDir = resolve(options.dir)
        const yamlPath = join(targetDir, 'fam.yaml')
        const globalOpts = program.opts()
        const famDir = expandTilde(globalOpts.famDir as string ?? '~/.fam')

        // 1. Check if fam.yaml already exists
        if (existsSync(yamlPath) && !options.force) {
          console.error(
            chalk.red('Error:') +
              ` fam.yaml already exists at ${yamlPath}. Use --force to overwrite.`,
          )
          process.exit(1)
        }

        console.log(chalk.bold('\nFAM v1.0.0 -- Initialize\n'))

        // 2. Prompt: "Which tools do you use?"
        const selectedTools = await checkbox({
          message: 'Which AI tools do you use?',
          choices: TOOL_CHOICES.map((t) => ({
            name: t.name,
            value: t.value,
          })),
        })

        if (selectedTools.length === 0) {
          console.log(chalk.yellow('No tools selected. Creating minimal config.'))
        }

        // 3. Scan for existing MCP configs
        const discovered = scanForExistingConfigs(selectedTools)

        // 4. Offer to import found configs
        let importedServers: DiscoveredServer[] = []
        if (discovered.length > 0) {
          console.log(
            chalk.cyan(`\nFound ${discovered.length} existing MCP server(s):`),
          )
          for (const server of discovered) {
            console.log(`  - ${server.name} (from ${server.source})`)
          }

          const shouldImport = await confirm({
            message: 'Import these into your fam.yaml?',
            default: true,
          })

          if (shouldImport) {
            importedServers = discovered
          }
        }

        // 5. Write fam.yaml scaffold
        const scaffold = buildScaffold(selectedTools, importedServers)
        const yamlContent =
          '# FAM Configuration -- Generated by `fam init`\n' +
          '# Documentation: https://github.com/sweetpapatech/fam\n\n' +
          yamlStringify(scaffold, { lineWidth: 100 })

        writeFileSync(yamlPath, yamlContent, 'utf-8')
        console.log(chalk.green(`\nCreated ${yamlPath}`))

        // 6. Create ~/.fam/ directory structure
        const subdirs = ['configs', 'instructions']
        mkdirSync(famDir, { recursive: true })
        for (const sub of subdirs) {
          mkdirSync(join(famDir, sub), { recursive: true })
        }
        console.log(chalk.green(`Created ${famDir}/`))

        // 7. Print next steps
        console.log(chalk.bold('\nNext steps:'))
        console.log(`  1. Edit ${chalk.cyan('fam.yaml')} to add MCP servers and credentials`)
        console.log(`  2. Run ${chalk.cyan('fam plan')} to review what will be configured`)
        console.log(`  3. Run ${chalk.cyan('fam apply')} to activate your configuration`)
        if (Object.keys(scaffold['credentials'] as Record<string, unknown>).length === 0) {
          console.log(
            `  4. Run ${chalk.cyan('fam secret set <name>')} to store API keys in your OS keychain`,
          )
        }
        console.log()

        process.exit(0)
      } catch (err) {
        // Ctrl+C during inquirer prompts throws ExitPromptError
        if (
          err instanceof Error &&
          (err.name === 'ExitPromptError' || err.message.includes('User force closed'))
        ) {
          console.log(chalk.dim('\nAborted.'))
          process.exit(0)
        }
        if (err instanceof FamError) {
          console.error(chalk.red(`Error [${err.code}]:`) + ` ${err.message}`)
          process.exit(err.exitCode)
        }
        throw err
      }
    })
}
