/**
 * generators/roo-code.ts — Roo Code (VS Code extension) config generator.
 *
 * Produces .roo/mcp.json (project-level) with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateRooCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push('Roo Code: Model configuration must be done through the Roo Code extension UI')
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : '.roo/mcp.json'

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
