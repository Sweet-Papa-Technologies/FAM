/**
 * generators/continue-dev.ts — Continue.dev config generator.
 *
 * Produces ~/.continue/config.yaml with model definitions and
 * MCP server entries.
 *
 * Continue.dev config.yaml requires top-level name/version/schema fields.
 * Model entries require both "name" (display) and "model" (ID) fields.
 * MCP server headers go under "requestOptions.headers" (not top-level).
 *
 * Supported roles:
 *   - chat         → model with roles: [chat]
 *   - edit         → model with roles: [edit]
 *   - apply        → model with roles: [apply]
 *   - autocomplete → model with roles: [autocomplete]
 *   - embed        → model with roles: [embed]
 *
 * When multiple roles map to the same model, they are merged
 * into a single model entry with multiple roles.
 */

import { stringify as yamlStringify } from 'yaml'
import type { GeneratorInput, GeneratorOutput } from './types.js'
import type { ResolvedModel } from '../config/types.js'
import { expandTilde } from '../utils/paths.js'

const KNOWN_ROLES = new Set(['chat', 'edit', 'apply', 'autocomplete', 'embed'])

/**
 * Map provider type to Continue.dev provider name.
 */
function continueProvider(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    openai_compatible: 'openai',
    google: 'gemini',
    amazon_bedrock: 'bedrock',
  }
  return map[provider] ?? provider
}

function modelKey(m: ResolvedModel): string {
  return `${m.provider}:${m.model_id}:${m.base_url ?? ''}`
}

export function generateContinueDevConfig(input: GeneratorInput): GeneratorOutput {
  const warnings: string[] = []
  const config: Record<string, unknown> = {
    name: 'FAM Managed Config',
    version: '1.0.0',
    schema: 'v1',
  }

  if (input.models?.default) {
    // Build a map of unique models → their roles
    const modelRoleMap = new Map<string, { model: ResolvedModel; roles: string[] }>()

    // Default model gets 'chat' role if no explicit chat role is set
    const defaultKey = modelKey(input.models.default)
    modelRoleMap.set(defaultKey, { model: input.models.default, roles: ['chat'] })

    // Assign roles from model_roles
    for (const [role, resolved] of Object.entries(input.models.roles ?? {})) {
      if (!KNOWN_ROLES.has(role)) {
        // Skip unknown roles silently
        continue
      }
      const key = modelKey(resolved)
      const existing = modelRoleMap.get(key)
      if (existing) {
        // Remove default 'chat' from default model if chat is explicitly assigned elsewhere
        if (role === 'chat' && key !== defaultKey) {
          const defaultEntry = modelRoleMap.get(defaultKey)
          if (defaultEntry) {
            defaultEntry.roles = defaultEntry.roles.filter(r => r !== 'chat')
            if (defaultEntry.roles.length === 0) {
              modelRoleMap.delete(defaultKey)
            }
          }
        }
        if (!existing.roles.includes(role)) {
          existing.roles.push(role)
        }
      } else {
        // If this role was 'chat' and was defaulted on the default model, remove it there
        if (role === 'chat') {
          const defaultEntry = modelRoleMap.get(defaultKey)
          if (defaultEntry) {
            defaultEntry.roles = defaultEntry.roles.filter(r => r !== 'chat')
            if (defaultEntry.roles.length === 0) {
              modelRoleMap.delete(defaultKey)
            }
          }
        }
        modelRoleMap.set(key, { model: resolved, roles: [role] })
      }
    }

    const models: Array<Record<string, unknown>> = []
    for (const { model, roles } of modelRoleMap.values()) {
      if (roles.length === 0) continue
      models.push({
        name: model.model_id,
        model: model.model_id,
        provider: continueProvider(model.provider),
        ...(model.api_key ? { apiKey: model.api_key } : {}),
        ...(model.base_url ? { apiBase: model.base_url } : {}),
        roles,
      })
    }

    config['models'] = models
  }

  // MCP servers section — headers go under requestOptions
  const mcpUrl = input.daemonUrl.replace(/\/$/, '') + '/mcp'
  config['mcpServers'] = [
    {
      name: 'fam',
      type: 'sse',
      url: mcpUrl,
      requestOptions: {
        headers: { Authorization: `Bearer ${input.sessionToken}` },
      },
    },
  ]

  const outputPath = expandTilde('~/.continue/config.yaml')

  return {
    path: outputPath,
    content: yamlStringify(config, { lineWidth: 120 }),
    format: 'yaml',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
