/**
 * cli/config-manage.ts — `fam config manage <profile>` command.
 *
 * Re-triggers the I/O/S merge strategy prompt for a profile whose
 * strategy was already recorded in state.json. Per DESIGN.md Section 8.2.
 */

import { Command } from 'commander'
import { resolve } from 'node:path'
import chalk from 'chalk'
import { select } from '@inquirer/prompts'

import { parseConfig, loadState, writeState, expandTilde } from '../config/index.js'
import type { State } from '../config/types.js'
import { detectExistingConfig } from '../generators/index.js'
import { FamError } from '../utils/errors.js'

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage FAM configuration')

  configCmd
    .command('manage <profile>')
    .description('Re-trigger merge strategy (Import/Overwrite/Skip) for a profile config file')
    .action(async (profileName: string) => {
      try {
        const globalOpts = program.opts()
        const configPath = resolve(globalOpts.config as string ?? './fam.yaml')
        const famDir = expandTilde(globalOpts.famDir as string ?? '~/.fam')

        const config = parseConfig(configPath)
        const state = loadState(famDir)

        // Find the profile
        const profile = config.profiles[profileName]
        if (!profile) {
          console.error(chalk.red(`Profile '${profileName}' not found in fam.yaml.`))
          console.log(chalk.dim(`Available profiles: ${Object.keys(config.profiles).join(', ')}`))
          process.exit(1)
        }

        // Find the generator for this profile
        const genName = profile.config_target
        const generator = config.generators[genName]
        if (!generator) {
          console.error(chalk.red(`No generator '${genName}' found for profile '${profileName}'.`))
          process.exit(1)
        }

        const targetPath = expandTilde(generator.output)
        const currentStrategy = state.generated_configs[genName]?.strategy

        if (currentStrategy) {
          console.log(chalk.dim(`Current strategy for ${targetPath}: ${currentStrategy}`))
        }

        // Detect what's on disk
        const detection = detectExistingConfig(targetPath)
        if (detection.exists && detection.servers && detection.servers.length > 0) {
          console.log(
            chalk.dim(
              `File contains ${detection.servers.length} MCP server(s): ${detection.servers.map((s) => s.name).join(', ')}`,
            ),
          )
        }

        // Prompt for new strategy
        const strategy = await select({
          message: `How should FAM manage ${targetPath}?`,
          choices: [
            {
              name: 'Import & Manage — Backup existing, let FAM control this file',
              value: 'import_and_manage' as const,
            },
            {
              name: 'Overwrite — Backup existing, replace entirely with FAM config',
              value: 'overwrite' as const,
            },
            {
              name: 'Skip — Leave this file alone (manual management)',
              value: 'skip' as const,
            },
          ],
        })

        // Update state
        const updatedState: State = {
          ...state,
          generated_configs: {
            ...state.generated_configs,
            [genName]: {
              ...state.generated_configs[genName],
              path: targetPath,
              last_written: state.generated_configs[genName]?.last_written ?? '',
              content_hash: state.generated_configs[genName]?.content_hash ?? '',
              strategy,
            },
          },
        }

        writeState(famDir, updatedState)

        console.log(chalk.green(`Strategy for '${genName}' updated to: ${strategy}`))
        if (strategy !== 'skip') {
          console.log(chalk.dim('Run `fam apply` to regenerate the config file.'))
        }
      } catch (err) {
        if (err instanceof FamError) {
          console.error(chalk.red(`Error [${err.code}]: ${err.message}`))
          process.exit(err.exitCode)
        }
        throw err
      }
    })
}
