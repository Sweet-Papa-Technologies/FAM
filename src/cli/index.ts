/**
 * cli/index.ts — Main Commander program setup.
 *
 * This file OWNS all command registration. Import commands from their
 * files and register them on the root program instance.
 */

import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expandTilde } from '../config/index.js'
import { FAM_VERSION } from '../utils/version.js'

const program = new Command()
program
  .name('fam')
  .description('FoFo Agent Manager -- One config. Every agent.')
  .version(FAM_VERSION)

// Global options
program
  .option('--config <path>', 'Path to fam.yaml')
  .option('--fam-dir <path>', 'Path to FAM data directory', '~/.fam')
  .option('-v, --verbose', 'Verbose output')
  .option('--json', 'JSON output for scripting')
  .option('--no-color', 'Disable color output')

// Resolve --config with fallback: ./fam.yaml → ~/.fam/fam.yaml
program.hook('preAction', () => {
  const opts = program.opts()
  if (!opts.config) {
    if (existsSync(resolve('./fam.yaml'))) {
      program.setOptionValue('config', resolve('./fam.yaml'))
    } else {
      const fallback = expandTilde('~/.fam/fam.yaml')
      if (existsSync(fallback)) {
        program.setOptionValue('config', fallback)
      } else {
        program.setOptionValue('config', resolve('./fam.yaml'))
      }
    }
  }
})

// Register all commands
import { registerInitCommand } from './init.js'
import { registerPlanCommand } from './plan.js'
import { registerApplyCommand } from './apply.js'
import { registerValidateCommand } from './validate.js'
import { registerStatusCommand } from './status.js'
import { registerMcpCommand } from './mcp-manage.js'
import { registerConfigCommand } from './config-manage.js'
import { registerSecretCommand } from './secret.js'
import { registerRegisterCommand } from './register.js'
import { registerDaemonCommand } from './daemon.js'
import { registerLogCommand } from './log.js'
import { registerAuthCommand } from './auth.js'
import { registerKnowledgeCommand } from './knowledge.js'
import { registerDriftCommand } from './drift.js'

registerInitCommand(program)
registerPlanCommand(program)
registerApplyCommand(program)
registerValidateCommand(program)
registerStatusCommand(program)
registerMcpCommand(program)
registerConfigCommand(program)
registerSecretCommand(program)
registerRegisterCommand(program)
registerDaemonCommand(program)
registerLogCommand(program)
registerAuthCommand(program)
registerKnowledgeCommand(program)
registerDriftCommand(program)

export { program }
