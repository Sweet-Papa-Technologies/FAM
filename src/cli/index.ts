/**
 * cli/index.ts -- Main Commander program setup.
 *
 * This file OWNS all command registration. Import commands from their
 * files and register them on the root program instance.
 */

import { Command } from 'commander'

const program = new Command()
program
  .name('fam')
  .description('FoFo Agent Manager -- One config. Every agent.')
  .version('0.1.0')

// Global options
program
  .option('--config <path>', 'Path to fam.yaml', './fam.yaml')
  .option('--fam-dir <path>', 'Path to FAM data directory', '~/.fam')
  .option('-v, --verbose', 'Verbose output')
  .option('--json', 'JSON output for scripting')
  .option('--no-color', 'Disable color output')

// Register all commands
import { registerInitCommand } from './init.js'
import { registerPlanCommand } from './plan.js'
import { registerApplyCommand } from './apply.js'
import { registerValidateCommand } from './validate.js'
import { registerStatusCommand } from './status.js'
import { registerMcpCommand } from './mcp-manage.js'
// Secondary CLI agent stubs:
import { registerSecretCommand } from './secret.js'
import { registerRegisterCommand } from './register.js'
import { registerDaemonCommand } from './daemon.js'
import { registerLogCommand } from './log.js'

registerInitCommand(program)
registerPlanCommand(program)
registerApplyCommand(program)
registerValidateCommand(program)
registerStatusCommand(program)
registerMcpCommand(program)
registerSecretCommand(program)
registerRegisterCommand(program)
registerDaemonCommand(program)
registerLogCommand(program)

export { program }
