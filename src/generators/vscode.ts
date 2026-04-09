/**
 * generators/vscode.ts — VS Code config generator.
 *
 * Produces .vscode/mcp.json with a "servers" entry (not "mcpServers")
 * using "type": "http" (Streamable HTTP, the recommended transport).
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateVSCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    servers: {
      fam: {
        type: 'http',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push('VS Code: Model configuration depends on the AI extension in use (Copilot, Continue, Cline, etc.)')
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('.vscode/mcp.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
