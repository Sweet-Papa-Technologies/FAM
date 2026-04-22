/**
 * generators/claude-code.ts — Claude Code config generator.
 *
 * Claude Code reads from TWO different files with different schemas:
 *
 *   1. ~/.claude.json            → MCP servers (top-level `mcpServers`),
 *                                   account state, per-project mcpServers map.
 *                                   This is what `claude mcp list` reads from.
 *   2. ~/.claude/settings.json   → User settings (env block, permissions, hooks).
 *
 * The primary output is ~/.claude.json with user-scope mcpServers (entry shape:
 * `{ type: "http", url, headers }`). The env block, when a compatible model is
 * configured, is emitted as a secondary file at ~/.claude/settings.json.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateClaudeCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  // --- Primary file: ~/.claude.json with mcpServers ----------------------
  const mainConfig: Record<string, unknown> = {
    mcpServers: {
      fam: {
        type: 'http',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.claude.json')

  const additionalFiles: GeneratorOutput['additionalFiles'] = []

  // --- Secondary file: ~/.claude/settings.json with env block ------------
  if (input.models?.default) {
    const m = input.models.default

    // Claude Code only supports Anthropic models (or Anthropic-compatible proxies
    // like Bedrock/Vertex). Non-Anthropic providers are skipped with a warning.
    const compatible = m.provider === 'anthropic' || m.provider === 'amazon_bedrock'

    if (!compatible) {
      warnings.push(
        `Profile "${input.profile.name}" assigns a "${m.provider}" model to a claude_code target. ` +
        `Claude Code only supports Anthropic models — skipping model configuration. ` +
        `MCP servers will still be configured.`,
      )
    } else {
      const env: Record<string, string> = {}

      if (m.api_key) env['ANTHROPIC_API_KEY'] = m.api_key
      if (m.base_url) env['ANTHROPIC_BASE_URL'] = m.base_url
      env['ANTHROPIC_MODEL'] = m.model_id

      const roles = input.models.roles ?? {}
      if (roles.sonnet_tier) env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = roles.sonnet_tier.model_id
      if (roles.opus_tier) env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = roles.opus_tier.model_id
      if (roles.haiku_tier) env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = roles.haiku_tier.model_id

      if (input.profile.env_inject) {
        Object.assign(env, input.profile.env_inject)
      }

      additionalFiles.push({
        path: expandTilde('~/.claude/settings.json'),
        content: JSON.stringify({ env }, null, 2) + '\n',
        format: 'json',
      })
    }
  }

  return {
    path: outputPath,
    content: JSON.stringify(mainConfig, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(additionalFiles.length > 0 ? { additionalFiles } : {}),
  }
}
