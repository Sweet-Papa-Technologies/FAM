/**
 * generators/opencode.ts — OpenCode config generator.
 *
 * Produces opencode.json with FAM MCP entry + model configuration.
 * OpenCode uses singular keys: "mcp", "provider".
 * Built-in roles (coder/task) map to root "model" / "small_model".
 * Model strings use "provider/model-id" format.
 *
 * For custom/OpenAI-compatible providers (e.g. Ollama), OpenCode requires:
 *   - npm: the AI SDK package (e.g. "@ai-sdk/openai-compatible")
 *   - models: a map declaring available model IDs
 *   - options.baseURL: the API endpoint
 *
 * See: https://opencode.ai/docs/providers
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

/** Map FAM provider type to OpenCode's built-in provider name. */
const BUILTIN_PROVIDERS: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'gemini',
}

/** Map FAM provider type to the AI SDK npm package OpenCode uses. */
const SDK_PACKAGES: Record<string, string> = {
  anthropic: '@ai-sdk/anthropic',
  openai: '@ai-sdk/openai',
  openai_compatible: '@ai-sdk/openai-compatible',
  google: '@ai-sdk/google',
}

interface ProviderEntry {
  npm?: string
  name?: string
  options?: Record<string, unknown>
  models?: Record<string, { name: string }>
}

/**
 * Build an OpenCode provider config entry from a resolved FAM model.
 */
function buildProviderEntry(
  famProvider: string,
  modelId: string,
  apiKey: string | null | undefined,
  baseUrl: string | undefined,
): { providerName: string; entry: ProviderEntry } {
  const isBuiltin = famProvider in BUILTIN_PROVIDERS

  if (isBuiltin) {
    // Built-in providers only need options overrides
    const providerName = BUILTIN_PROVIDERS[famProvider]
    const options: Record<string, unknown> = {}
    if (apiKey) options['apiKey'] = apiKey
    if (baseUrl) options['baseURL'] = baseUrl

    return {
      providerName,
      entry: Object.keys(options).length > 0 ? { options } : {},
    }
  }

  // Custom / openai_compatible providers need full registration.
  // Detect Ollama by its standard port (11434), otherwise use "custom".
  let providerName = 'custom'
  if (baseUrl) {
    try {
      const url = new URL(baseUrl)
      if (url.port === '11434' || url.pathname.startsWith('/v1') && url.port === '11434') {
        providerName = 'ollama'
      }
    } catch { /* use default */ }
  }

  const options: Record<string, unknown> = {}
  if (baseUrl) options['baseURL'] = baseUrl
  if (apiKey) options['apiKey'] = apiKey

  return {
    providerName,
    entry: {
      npm: SDK_PACKAGES[famProvider] ?? '@ai-sdk/openai-compatible',
      name: providerName.charAt(0).toUpperCase() + providerName.slice(1),
      ...(Object.keys(options).length > 0 ? { options } : {}),
      models: {
        [modelId]: { name: modelId },
      },
    },
  }
}

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

  if (input.models?.default) {
    const m = input.models.default
    const roles = input.models.roles ?? {}
    const providerConfigs: Record<string, ProviderEntry> = {}

    // Default / coder model
    const defaultProvider = buildProviderEntry(m.provider, m.model_id, m.api_key, m.base_url)
    if (Object.keys(defaultProvider.entry).length > 0) {
      providerConfigs[defaultProvider.providerName] = defaultProvider.entry
    }

    if (roles.coder) {
      const coderProvider = buildProviderEntry(roles.coder.provider, roles.coder.model_id, roles.coder.api_key, roles.coder.base_url)
      config['model'] = `${coderProvider.providerName}/${roles.coder.model_id}`
      if (Object.keys(coderProvider.entry).length > 0) {
        providerConfigs[coderProvider.providerName] = coderProvider.entry
      }
    } else {
      config['model'] = `${defaultProvider.providerName}/${m.model_id}`
    }

    // Task / small_model
    if (roles.task) {
      const taskProvider = buildProviderEntry(roles.task.provider, roles.task.model_id, roles.task.api_key, roles.task.base_url)
      config['small_model'] = `${taskProvider.providerName}/${roles.task.model_id}`
      if (Object.keys(taskProvider.entry).length > 0) {
        // Merge models if same provider
        if (providerConfigs[taskProvider.providerName]?.models && taskProvider.entry.models) {
          Object.assign(providerConfigs[taskProvider.providerName].models!, taskProvider.entry.models)
        } else {
          providerConfigs[taskProvider.providerName] = taskProvider.entry
        }
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
