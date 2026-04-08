/**
 * generators/opencode.ts — OpenCode config generator.
 *
 * Produces opencode.json MCP section with a remote FAM entry.
 * OpenCode uses "mcp" as the root key (not "mcpServers") and
 * "type": "remote" for HTTP/SSE servers.
 *
 * See: https://opencode.ai/docs/mcp-servers
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

export function generateOpenCodeConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)

  const config: Record<string, unknown> = {
    mcp: {
      fam: {
        type: 'remote',
        url: entry.url,
        enabled: true,
        headers: entry.headers,
      },
    },
  }

  // Model configuration via providers + agents sections
  if (input.models?.default) {
    const m = input.models.default
    const providerKindMap: Record<string, string> = {
      anthropic: 'anthropic',
      openai: 'openai',
      openai_compatible: 'openai',
      google: 'google',
    }
    const providerId = `fam-${m.provider}`

    config['providers'] = {
      [providerId]: {
        kind: providerKindMap[m.provider] ?? 'openai',
        apiKey: m.api_key ?? '',
        ...(m.base_url ? { baseURL: m.base_url } : {}),
      },
    }

    const agents: Record<string, unknown> = {}
    const roles = input.models.roles ?? {}

    if (roles.coder) {
      agents['coder'] = { model: roles.coder.model_id, provider: providerId }
    } else {
      agents['coder'] = { model: m.model_id, provider: providerId }
    }

    if (roles.task) {
      // If task uses a different provider, add that provider too
      if (roles.task.provider !== m.provider || roles.task.base_url !== m.base_url) {
        const taskProviderId = `fam-${roles.task.provider}-task`
        ;(config['providers'] as Record<string, unknown>)[taskProviderId] = {
          kind: providerKindMap[roles.task.provider] ?? 'openai',
          apiKey: roles.task.api_key ?? '',
          ...(roles.task.base_url ? { baseURL: roles.task.base_url } : {}),
        }
        agents['task'] = { model: roles.task.model_id, provider: taskProviderId }
      } else {
        agents['task'] = { model: roles.task.model_id, provider: providerId }
      }
    }

    config['agents'] = agents
  }

  const outputPath = expandTilde('~/.config/opencode/opencode.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
