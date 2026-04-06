/**
 * generators/generic.ts — Generic config generator.
 *
 * Produces ~/.fam/configs/<profile_name>.json with a minimal
 * JSON config containing profile name, MCP endpoint, token, and transport.
 * Used for tools that don't have a dedicated generator.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { expandTilde } from '../utils/paths.js'

export function generateGenericConfig(input: GeneratorInput): GeneratorOutput {
  const mcpUrl = input.daemonUrl.replace(/\/$/, '') + '/mcp'

  const config = {
    profile: input.profile.name,
    mcp_endpoint: mcpUrl,
    token: input.sessionToken,
    transport: 'sse',
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde(`~/.fam/configs/${input.profile.name}.json`)

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
