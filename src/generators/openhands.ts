/**
 * generators/openhands.ts — OpenHands config generator.
 *
 * Produces ~/.openhands/config.toml with an [mcp] section
 * and optional [llm] section when env_inject contains model config.
 * TOML is manually constructed (no external dependency).
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { expandTilde } from '../utils/paths.js'

/**
 * Escape a TOML string value: wrap in double quotes, escape internal
 * double quotes and backslashes.
 */
function tomlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

export function generateOpenHandsConfig(input: GeneratorInput): GeneratorOutput {
  const mcpUrl = input.daemonUrl.replace(/\/$/, '') + '/mcp'
  const lines: string[] = []

  // If the profile has env_inject with model config, include the [llm] section
  const envInject = input.profile.env_inject
  if (envInject) {
    const apiKey = envInject['api_key'] ?? envInject['OPENAI_API_KEY'] ?? envInject['ANTHROPIC_API_KEY']
    const model = input.profile.model ?? envInject['model']

    if (apiKey || model) {
      lines.push('[llm]')
      if (apiKey) {
        lines.push(`api_key = ${tomlString(apiKey)}`)
      }
      if (model) {
        lines.push(`model = ${tomlString(model)}`)
      }
      lines.push('')
    }
  }

  // [mcp] section with the FAM server entry
  lines.push('[mcp]')
  lines.push('servers = [')
  lines.push(`  { name = "fam", url = ${tomlString(mcpUrl)}, transport = "sse", token = ${tomlString(input.sessionToken)} }`)
  lines.push(']')
  lines.push('')

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.openhands/config.toml')

  return {
    path: outputPath,
    content: lines.join('\n'),
    format: 'toml',
  }
}
