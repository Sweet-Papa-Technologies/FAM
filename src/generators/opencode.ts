/**
 * generators/opencode.ts — OpenCode config generator.
 *
 * Produces opencode.json MCP section with a remote FAM entry.
 * OpenCode uses "mcp" as the root key (not "mcpServers") and
 * "type": "remote" for HTTP/SSE servers.
 *
 * See: https://opencode.ai/docs/mcp-servers
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateOpenCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  const config = {
    mcp: {
      fam: {
        type: 'remote',
        url: entry.url,
        enabled: true,
        headers: entry.headers,
      },
    },
  }

  const outputPath = expandTilde('~/.config/opencode/opencode.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
