/**
 * generators/vscode.ts — VS Code config generator.
 *
 * Produces .vscode/mcp.json with a "servers" entry (not "mcpServers")
 * using "type" (not "transport") — VS Code uses a slightly different schema.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateVSCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  const config = {
    servers: {
      fam: {
        type: 'sse',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('.vscode/mcp.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
