/**
 * generators/amazon-q.ts — Amazon Q Developer config generator.
 *
 * Produces ~/.aws/amazonq/agents/default.json with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateAmazonQConfig(input: GeneratorInput): GeneratorOutput {
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
    : expandTilde('~/.aws/amazonq/agents/default.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
