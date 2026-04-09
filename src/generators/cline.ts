/**
 * generators/cline.ts — Cline (VS Code extension) config generator.
 *
 * Produces cline_mcp_settings.json with an mcpServers entry.
 * Cline uses "type" (not "transport") with values "sse", "streamableHttp", or "stdio".
 * Model/provider settings (cline.apiProvider, etc.) are VS Code extension settings
 * and do NOT belong in this file.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateClineConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        type: 'sse',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push(
      'Cline: Model and API key must be configured through the Cline extension UI or VS Code settings.json ' +
      '(cline.apiProvider, cline.apiModelId, etc.)',
    )
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.cline/data/settings/cline_mcp_settings.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
