/**
 * generators/cursor.ts — Cursor config generator.
 *
 * Produces ~/.cursor/mcp.json with an mcpServers entry.
 * Cursor auto-detects transport from the url field (tries Streamable HTTP,
 * falls back to SSE). No transport/type field needed.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateCursorConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    mcpServers: {
      fam: {
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push('Cursor: Model and API key configuration is GUI-only. Configure in Cursor Settings > Models.')
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.cursor/mcp.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
