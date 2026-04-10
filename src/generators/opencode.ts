/**
 * generators/opencode.ts — OpenCode config generator.
 *
 * Produces opencode.json with FAM MCP entry + model configuration.
 * OpenCode uses singular keys: "mcp", "provider", "agent".
 * Built-in roles (coder/task) map to root "model" / "small_model".
 * Model strings use "provider/model-id" format.
 *
 * See: https://opencode.ai/docs/config
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

  // Model configuration via root-level model/small_model + provider options
  // OpenCode uses singular "provider" and "agent" keys (not plural).
  // Built-in roles (coder/task) map to root "model" / "small_model".
  if (input.models?.default) {
    const m = input.models.default
    const providerKindMap: Record<string, string> = {
      anthropic: 'anthropic',
      openai: 'openai',
      openai_compatible: 'openai',
      google: 'google',
    }
    const providerName = providerKindMap[m.provider] ?? 'openai'
    const roles = input.models.roles ?? {}

    // Root-level model in "provider/model-id" format (maps to coder role)
    if (roles.coder) {
      const coderProvider = providerKindMap[roles.coder.provider] ?? 'openai'
      config['model'] = `${coderProvider}/${roles.coder.model_id}`
    } else {
      config['model'] = `${providerName}/${m.model_id}`
    }

    // small_model maps to the task role
    if (roles.task) {
      const taskProvider = providerKindMap[roles.task.provider] ?? 'openai'
      config['small_model'] = `${taskProvider}/${roles.task.model_id}`
    }

    // Provider options (base URL, API key, etc.)
    // OpenAI SDK requires an apiKey to initialize, even for keyless endpoints
    // like Ollama. Use a placeholder when no real key is configured.
    const providerOptions: Record<string, unknown> = {}
    if (m.api_key) {
      providerOptions['apiKey'] = m.api_key
    } else if (m.provider === 'openai_compatible') {
      providerOptions['apiKey'] = 'not-needed'
    }
    if (m.base_url) providerOptions['baseURL'] = m.base_url

    // Collect all unique providers that need options
    const providerConfigs: Record<string, Record<string, unknown>> = {}
    if (Object.keys(providerOptions).length > 0) {
      providerConfigs[providerName] = { options: providerOptions }
    }

    // Add task provider options if it differs
    if (roles.task && (roles.task.provider !== m.provider || roles.task.base_url !== m.base_url)) {
      const taskProviderName = providerKindMap[roles.task.provider] ?? 'openai'
      const taskOptions: Record<string, unknown> = {}
      if (roles.task.api_key) {
        taskOptions['apiKey'] = roles.task.api_key
      } else if (roles.task.provider === 'openai_compatible') {
        taskOptions['apiKey'] = 'not-needed'
      }
      if (roles.task.base_url) taskOptions['baseURL'] = roles.task.base_url
      if (Object.keys(taskOptions).length > 0) {
        providerConfigs[taskProviderName] = { options: taskOptions }
      }
    }

    if (Object.keys(providerConfigs).length > 0) {
      config['provider'] = providerConfigs
    }
  }

  const outputPath = expandTilde('~/.config/opencode/opencode.json')

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
  }
}
