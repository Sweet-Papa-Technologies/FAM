/**
 * generators/nemoclaw.ts — NVIDIA NemoClaw config generator.
 *
 * NemoClaw is NVIDIA's enterprise wrapper around OpenClaw that runs
 * on NVIDIA OpenShell with sandboxing and managed inference.
 *
 * Produces:
 *   - ~/.nemoclaw/openclaw.json — mcpServers entry (same format as OpenClaw)
 *
 * Model configuration in NemoClaw is primarily env-var driven
 * (NEMOCLAW_PROVIDER, NEMOCLAW_MODEL, NEMOCLAW_ENDPOINT_URL, etc.)
 * because its config.json is managed by the `nemoclaw onboard` wizard.
 * We emit warnings with the env vars users need to set.
 *
 * For non-interactive deployments, users can run:
 *   NEMOCLAW_PROVIDER=custom \
 *   NEMOCLAW_ENDPOINT_URL=http://localhost:8000/v1 \
 *   NEMOCLAW_MODEL=model-name \
 *   nemoclaw onboard --non-interactive
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

/**
 * Map FAM provider type to NemoClaw's NEMOCLAW_PROVIDER value.
 */
function nemoclawProvider(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'custom',
    openai: 'custom',
    openai_compatible: 'custom',
    google: 'custom',
    amazon_bedrock: 'custom',
  }
  return map[provider] ?? 'custom'
}

export function generateNemoClawConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  // NemoClaw uses OpenClaw's config format for MCP servers
  const config: Record<string, unknown> = {
    mcpServers: {
      fam: {
        url: entry.url,
        transport: entry.transport,
        headers: entry.headers,
      },
    },
  }

  // Model config is env-var driven — emit setup instructions
  if (input.models?.default) {
    const m = input.models.default
    const envHints: string[] = [
      `NEMOCLAW_PROVIDER=${nemoclawProvider(m.provider)}`,
      `NEMOCLAW_MODEL=${m.model_id}`,
    ]

    if (m.base_url) {
      envHints.push(`NEMOCLAW_ENDPOINT_URL=${m.base_url}`)
    } else {
      // Standard provider endpoints
      const defaultUrls: Record<string, string> = {
        anthropic: 'https://api.anthropic.com/v1',
        openai: 'https://api.openai.com/v1',
      }
      if (defaultUrls[m.provider]) {
        envHints.push(`NEMOCLAW_ENDPOINT_URL=${defaultUrls[m.provider]}`)
      }
    }

    if (m.api_key) {
      envHints.push('COMPATIBLE_API_KEY=<stored in vault>')
    }

    warnings.push(
      `NemoClaw: Run onboard with: ${envHints.join(' ')} nemoclaw onboard --non-interactive`
    )
  }

  const outputPath = expandTilde('~/.nemoclaw/openclaw.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
