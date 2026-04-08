/**
 * generators/claude-code.ts — Claude Code config generator.
 *
 * Produces ~/.claude/settings.json with an mcpServers entry
 * pointing at the FAM daemon.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateClaudeCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  // Model configuration via env block
  if (input.models?.default) {
    const env: Record<string, string> = {}
    const m = input.models.default

    if (m.api_key) env['ANTHROPIC_API_KEY'] = m.api_key
    if (m.base_url) env['ANTHROPIC_BASE_URL'] = m.base_url
    env['ANTHROPIC_MODEL'] = m.model_id

    // Role-specific tier models
    const roles = input.models.roles ?? {}
    if (roles.sonnet_tier) env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = roles.sonnet_tier.model_id
    if (roles.opus_tier) env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = roles.opus_tier.model_id
    if (roles.haiku_tier) env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = roles.haiku_tier.model_id

    // Merge with explicit env_inject (env_inject wins on conflict)
    if (input.profile.env_inject) {
      Object.assign(env, input.profile.env_inject)
    }

    config['env'] = env
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.claude/settings.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
