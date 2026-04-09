/**
 * generators/amazon-q.ts — Amazon Q Developer config generator.
 *
 * Produces ~/.aws/amazonq/mcp.json with an mcpServers entry.
 * Amazon Q CLI uses "type": "http" for remote servers.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateAmazonQConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    mcpServers: {
      fam: {
        type: 'http',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push(`Amazon Q: Set model via CLI: q settings chat.defaultModel "${input.models.default.model_id}"`)
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.aws/amazonq/mcp.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
