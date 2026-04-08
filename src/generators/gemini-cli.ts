/**
 * generators/gemini-cli.ts — Gemini CLI (Google) config generator.
 *
 * Produces ~/.gemini/settings.json with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateGeminiCliConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  // Model configuration
  if (input.models?.default) {
    config['model'] = { name: input.models.default.model_id }
    if (input.models.default.api_key) {
      warnings.push(`Gemini CLI: Set GEMINI_API_KEY in your environment or ~/.gemini/.env`)
    }
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.gemini/settings.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
