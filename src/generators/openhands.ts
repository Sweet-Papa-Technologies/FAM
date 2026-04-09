/**
 * generators/openhands.ts — OpenHands config generator.
 *
 * Produces config.toml with [llm] and [mcp] sections.
 * OpenHands uses sse_servers / shttp_servers / stdio_servers keys
 * (not a generic "servers" key). Server objects use url + api_key.
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

  // Model configuration: prefer resolved models, fall back to env_inject
  if (input.models?.default) {
    const m = input.models.default
    lines.push('[llm]')
    if (m.api_key) lines.push(`api_key = ${tomlString(m.api_key)}`)
    lines.push(`model = ${tomlString(m.model_id)}`)
    if (m.base_url) lines.push(`base_url = ${tomlString(m.base_url)}`)
    lines.push('')
  } else {
    // Legacy env_inject-based model config (backward compat)
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
  }

  // [mcp] section — OpenHands uses sse_servers (not generic "servers")
  lines.push('[mcp]')
  lines.push('sse_servers = [')
  lines.push(`  { url = ${tomlString(mcpUrl)}, api_key = ${tomlString(input.sessionToken)} }`)
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
