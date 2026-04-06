/**
 * generators/instructions.ts — Instruction file (FAM.md) generator.
 *
 * Generates a per-profile markdown file describing available infrastructure,
 * tools, and usage instructions for the AI agent. Based on DESIGN.md Section 8.3.
 */

import type { GeneratorOutput, InstructionInput } from './types.js'
import { expandTilde } from '../utils/paths.js'

export function generateInstructionFile(input: InstructionInput): GeneratorOutput {
  const lines: string[] = []

  lines.push('## Available Infrastructure (via FAM)')
  lines.push('')
  lines.push(
    'You have access to a local MCP server at localhost:7865 that provides'
  )
  lines.push(
    'authenticated access to the following services. Connect as a standard'
  )
  lines.push(
    'MCP client — all authentication is handled for you.'
  )
  lines.push('')

  // Profile name
  lines.push(`### Your profile: ${input.profile.name}`)

  // Available tools grouped by server
  lines.push('### Available tools:')
  for (const [serverName, server] of Object.entries(input.servers)) {
    const toolList = server.tools.join(', ')
    lines.push(`- **${serverName}**: ${server.description}`)
    lines.push(`  - ${toolList}`)
  }
  lines.push('')

  // FAM native tools
  lines.push('### FAM tools:')
  for (const tool of input.nativeTools) {
    lines.push(`- **${tool}**`)
  }

  // Add descriptions for known FAM tools
  if (input.nativeTools.length === 0) {
    lines.push('- **fam.whoami**: Check your profile and permissions')
    lines.push('- **fam.log_action**: Report significant actions for audit trail')
    lines.push('- **fam.list_servers**: List available MCP servers')
    lines.push('- **fam.health**: Check daemon and server status')
  }
  lines.push('')

  // Usage section
  lines.push('### Usage:')
  lines.push(
    'Connect via MCP at localhost:7865/mcp. All credentials are managed'
  )
  lines.push(
    'automatically. Do not hardcode or request any API keys.'
  )

  // Extra context if provided
  if (input.extraContext) {
    lines.push('')
    lines.push(input.extraContext)
  }

  lines.push('')

  const outputPath = input.injectInto
    ? expandTilde(input.injectInto)
    : expandTilde(`~/.fam/instructions/${input.profile.name}.md`)

  return {
    path: outputPath,
    content: lines.join('\n'),
    format: 'markdown',
  }
}
