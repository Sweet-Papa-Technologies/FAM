import { describe, it, expect } from 'vitest'
import { generateOpenCodeConfig } from '../../../src/generators/opencode.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

const baseInput: GeneratorInput = {
  profile: {
    name: 'opencode',
    description: 'OpenCode IDE',
    config_target: 'opencode',
    allowed_servers: ['github'],
    denied_servers: [],
  },
  settings: {
    daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: false },
    audit: { enabled: true, retention_days: 90, export_format: 'json' as const },
  },
  sessionToken: 'fam_sk_opn_abc123',
  daemonUrl: 'http://localhost:7865',
}

describe('OpenCode model config', () => {
  it('should not include provider/model when no models', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.provider).toBeUndefined()
    expect(config.model).toBeUndefined()
    expect(config.small_model).toBeUndefined()
  })

  it('should include provider section with model config', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-ant-test',
        },
        roles: {},
      },
    })
    const config = JSON.parse(output.content)
    expect(config.provider).toBeDefined()
    expect(config.provider['anthropic']).toBeDefined()
    expect(config.provider['anthropic'].options.apiKey).toBe('sk-ant-test')
  })

  it('should set root model to default in provider/model-id format', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {},
      },
    })
    const config = JSON.parse(output.content)
    expect(config.model).toBe('anthropic/claude-sonnet-4')
  })

  it('should support separate coder and task roles', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-opus-4',
          api_key: 'sk-test',
        },
        roles: {
          coder: {
            provider: 'anthropic',
            model_id: 'claude-opus-4',
            api_key: 'sk-test',
          },
          task: {
            provider: 'anthropic',
            model_id: 'claude-haiku-4-5',
            api_key: 'sk-test',
          },
        },
      },
    })
    const config = JSON.parse(output.content)
    expect(config.model).toBe('anthropic/claude-opus-4')
    expect(config.small_model).toBe('anthropic/claude-haiku-4-5')
  })

  it('should handle cross-provider task role', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-opus-4',
          api_key: 'sk-ant',
        },
        roles: {
          task: {
            provider: 'openai',
            model_id: 'gpt-4o-mini',
            api_key: 'sk-openai',
          },
        },
      },
    })
    const config = JSON.parse(output.content)
    // Should have two providers
    expect(config.provider['anthropic']).toBeDefined()
    expect(config.provider['openai']).toBeDefined()
    expect(config.provider['openai'].options.apiKey).toBe('sk-openai')
    // Model strings
    expect(config.model).toBe('anthropic/claude-opus-4')
    expect(config.small_model).toBe('openai/gpt-4o-mini')
  })

  it('should include baseURL when base_url is set', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'openai_compatible',
          model_id: 'llama-3.3-70b',
          api_key: null,
          base_url: 'http://localhost:11434/v1',
        },
        roles: {},
      },
    })
    const config = JSON.parse(output.content)
    expect(config.provider['openai'].options.baseURL).toBe('http://localhost:11434/v1')
    expect(config.model).toBe('openai/llama-3.3-70b')
  })

  it('should still include mcp section with model config', () => {
    const output = generateOpenCodeConfig({
      ...baseInput,
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {},
      },
    })
    const config = JSON.parse(output.content)
    expect(config.mcp).toBeDefined()
    expect(config.mcp.fam).toBeDefined()
  })
})
