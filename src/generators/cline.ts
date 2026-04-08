/**
 * generators/cline.ts — Cline (VS Code extension) config generator.
 *
 * Produces cline_mcp_settings.json with an mcpServers entry
 * pointing at the FAM daemon.
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
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  // Partial model support via cline.* settings keys
  if (input.models?.default) {
    const m = input.models.default
    const providerMap: Record<string, string> = {
      anthropic: 'anthropic',
      openai: 'openai',
      openai_compatible: 'openai-compatible',
      google: 'gemini',
    }
    config['cline.apiProvider'] = providerMap[m.provider] ?? m.provider
    config['cline.apiModelId'] = m.model_id
    if (m.base_url) config['cline.openAiBaseUrl'] = m.base_url
    warnings.push('Cline: API key must be configured through the Cline extension UI')
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.vscode/extensions/cline/cline_mcp_settings.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
