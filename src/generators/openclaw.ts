/**
 * generators/openclaw.ts — OpenClaw config generator.
 *
 * Produces two files:
 *   1. ~/.openclaw/openclaw.json — mcpServers entry + model providers
 *   2. ~/.openclaw/models.yaml  — model tier config (primary/fallback/economy)
 *
 * OpenClaw uses a tiered model system:
 *   - primary:  complex tasks (code gen, architecture review, bug analysis)
 *   - fallback: used when primary provider is unavailable
 *   - economy:  simple tasks (file summaries, git messages, format checks)
 *
 * Provider format in openclaw.json uses "provider/model" naming
 * (e.g., "anthropic/claude-sonnet-4.6").
 *
 * Supported roles → OpenClaw tiers:
 *   - default / primary → primary tier
 *   - fallback          → fallback tier
 *   - economy           → economy tier
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import type { ResolvedModel } from '../config/types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

/**
 * Map FAM provider type to OpenClaw's provider prefix.
 */
function openclawProvider(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    openai_compatible: 'openai',
    google: 'google',
    amazon_bedrock: 'bedrock',
  }
  return map[provider] ?? provider
}

/**
 * Map FAM provider type to OpenClaw's api field.
 */
function openclawApiType(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'anthropic-messages',
    openai: 'openai-responses',
    openai_compatible: 'openai-completions',
    google: 'openai-responses',
    amazon_bedrock: 'openai-completions',
  }
  return map[provider] ?? 'openai-completions'
}

function buildTierEntry(m: ResolvedModel, maxTokens: number, temperature: number) {
  return {
    provider: `${openclawProvider(m.provider)}/${m.model_id}`,
    model: m.model_id,
    max_tokens: maxTokens,
    temperature,
  }
}

export function generateOpenClawConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  // Build openclaw.json content
  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  // Model provider config in openclaw.json
  if (input.models?.default) {
    const m = input.models.default
    const providerId = openclawProvider(m.provider)

    const providers: Record<string, unknown> = {
      [providerId]: {
        baseUrl: m.base_url ?? undefined,
        apiKey: m.api_key ?? '',
        api: openclawApiType(m.provider),
        models: [{ id: m.model_id, name: m.model_id }],
      },
    }

    // Add any cross-provider models from roles
    const roles = input.models.roles ?? {}
    for (const resolved of Object.values(roles)) {
      const roleProviderId = openclawProvider(resolved.provider)
      if (!providers[roleProviderId]) {
        providers[roleProviderId] = {
          baseUrl: resolved.base_url ?? undefined,
          apiKey: resolved.api_key ?? '',
          api: openclawApiType(resolved.provider),
          models: [{ id: resolved.model_id, name: resolved.model_id }],
        }
      } else {
        const existing = providers[roleProviderId] as Record<string, unknown>
        const models = existing['models'] as Array<{ id: string; name: string }>
        if (!models.some((m) => m.id === resolved.model_id)) {
          models.push({ id: resolved.model_id, name: resolved.model_id })
        }
      }
    }

    config['models'] = { providers }
  }

  const outputPath = expandTilde('~/.openclaw/openclaw.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}

/**
 * Generate the models.yaml tier config for OpenClaw.
 *
 * This is a secondary output — the apply pipeline calls the main generator,
 * but callers can also use this to produce the models.yaml separately.
 */
export function generateOpenClawModelsYaml(input: GeneratorInput): GeneratorOutput | null {
  if (!input.models?.default) return null

  const m = input.models.default
  const roles = input.models.roles ?? {}

  const lines: string[] = ['# OpenClaw model tiers — managed by FAM']

  // Primary tier (default model)
  lines.push('primary:')
  lines.push(`  provider: ${openclawProvider(m.provider)}/${m.model_id}`)
  lines.push(`  model: ${m.model_id}`)
  lines.push('  max_tokens: 8192')
  lines.push('  temperature: 0.3')

  // Fallback tier
  if (roles.fallback) {
    const fb = roles.fallback
    lines.push('fallback:')
    lines.push(`  provider: ${openclawProvider(fb.provider)}/${fb.model_id}`)
    lines.push(`  model: ${fb.model_id}`)
    lines.push('  max_tokens: 4096')
    lines.push('  temperature: 0.3')
  }

  // Economy tier
  if (roles.economy) {
    const ec = roles.economy
    lines.push('economy:')
    lines.push(`  provider: ${openclawProvider(ec.provider)}/${ec.model_id}`)
    lines.push(`  model: ${ec.model_id}`)
    lines.push('  max_tokens: 2048')
    lines.push('  temperature: 0.2')
  }

  lines.push('') // trailing newline

  return {
    path: expandTilde('~/.openclaw/models.yaml'),
    content: lines.join('\n'),
    format: 'yaml',
  }
}
