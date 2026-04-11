/**
 * generators/gemini-cli.ts — Gemini CLI (Google) config generator.
 *
 * Produces ~/.gemini/settings.json with an mcpServers entry.
 * Gemini CLI infers transport from field presence (url = SSE/auto-detect).
 * No transport field needed.
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateGeminiCliConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  // Model configuration
  // Gemini CLI only supports Google's models (Gemini API key, Google account, or Vertex AI).
  // Non-Google providers (anthropic, openai, openai_compatible) are not supported.
  if (input.models?.default) {
    const m = input.models.default
    if (m.provider === 'google') {
      config['model'] = { name: m.model_id }
      if (m.api_key) {
        warnings.push(`Gemini CLI: Set GEMINI_API_KEY in your environment or ~/.gemini/.env`)
      }
    } else {
      warnings.push(
        `Profile "${input.profile.name}" assigns a "${m.provider}" model to a gemini_cli target. ` +
        `Gemini CLI only supports Google models (Gemini API / Vertex AI) — skipping model configuration. ` +
        `MCP servers will still be configured.`,
      )
    }
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : expandTilde('~/.gemini/settings.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
