/**
 * generators/cursor.ts — Cursor config generator.
 *
 * Produces ~/.cursor/mcp.json with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateCursorConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  const config = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.cursor/mcp.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
