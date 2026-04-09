/**
 * generators/github-copilot.ts — GitHub Copilot CLI config generator.
 *
 * Produces ~/.copilot/mcp-config.json with an mcpServers entry.
 * Copilot CLI uses "type" (not "transport") with values "http", "sse", or "stdio".
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateGithubCopilotConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    mcpServers: {
      fam: {
        type: 'sse',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  // Copilot CLI uses env vars for model config (not config file)
  if (input.models?.default) {
    const m = input.models.default
    const envHints = [`COPILOT_MODEL=${m.model_id}`]
    if (m.base_url) envHints.push(`COPILOT_PROVIDER_BASE_URL=${m.base_url}`)
    if (m.api_key) envHints.push(`COPILOT_PROVIDER_API_KEY=<stored in vault>`)
    warnings.push(`Copilot CLI: Set env vars: ${envHints.join(', ')}`)
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.copilot/mcp-config.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
