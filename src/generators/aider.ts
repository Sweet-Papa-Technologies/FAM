/**
 * generators/aider.ts — Aider config generator.
 *
 * Produces .aider.conf.yml with model configuration.
 * Aider uses LiteLLM under the hood and accepts model names
 * in "provider/model_id" format.
 *
 * Supported roles:
 *   - default  → model:
 *   - editor   → editor-model:
 *   - weak     → weak-model:
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { expandTilde } from '../utils/paths.js'

/**
 * Map provider type to Aider's LiteLLM provider prefix.
 */
function aiderModelName(provider: string, modelId: string): string {
  const prefixMap: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    openai_compatible: 'openai',
    google: 'gemini',
    amazon_bedrock: 'bedrock',
  }
  const prefix = prefixMap[provider]
  return prefix ? `${prefix}/${modelId}` : modelId
}

export function generateAiderConfig(input: GeneratorInput): GeneratorOutput {
  const lines: string[] = ['# Aider config managed by FAM']
  const warnings: string[] = []

  if (input.models?.default) {
    const m = input.models.default
    lines.push(`model: ${aiderModelName(m.provider, m.model_id)}`)

    const roles = input.models.roles ?? {}
    if (roles.editor) {
      lines.push(`editor-model: ${aiderModelName(roles.editor.provider, roles.editor.model_id)}`)
    }
    if (roles.weak) {
      lines.push(`weak-model: ${aiderModelName(roles.weak.provider, roles.weak.model_id)}`)
    }

    // API key hints
    if (m.provider === 'anthropic' && m.api_key) {
      warnings.push('Aider: Set ANTHROPIC_API_KEY in your environment or .env file')
    } else if ((m.provider === 'openai' || m.provider === 'openai_compatible') && m.api_key) {
      warnings.push('Aider: Set OPENAI_API_KEY in your environment or .env file')
    }
    if (m.base_url) {
      lines.push(`openai-api-base: ${m.base_url}`)
    }
  }

  lines.push('') // trailing newline

  const outputPath = expandTilde('~/.aider.conf.yml')

  return {
    path: outputPath,
    content: lines.join('\n'),
    format: 'yaml',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
