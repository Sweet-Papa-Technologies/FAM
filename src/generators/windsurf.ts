/**
 * generators/windsurf.ts — Windsurf (Codeium AI IDE) config generator.
 *
 * Produces ~/.codeium/windsurf/mcp_config.json with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateWindsurfConfig(input: GeneratorInput): GeneratorOutput {
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
    : expandTilde('~/.codeium/windsurf/mcp_config.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
