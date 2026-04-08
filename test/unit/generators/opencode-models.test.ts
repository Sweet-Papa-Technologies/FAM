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
  it('should not include providers/agents when no models', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.providers).toBeUndefined()
    expect(config.agents).toBeUndefined()
  })

  it('should include providers section with model config', () => {
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
    expect(config.providers).toBeDefined()
    expect(config.providers['fam-anthropic']).toBeDefined()
    expect(config.providers['fam-anthropic'].kind).toBe('anthropic')
    expect(config.providers['fam-anthropic'].apiKey).toBe('sk-ant-test')
  })

  it('should set coder agent to default model', () => {
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
    expect(config.agents.coder.model).toBe('claude-sonnet-4')
    expect(config.agents.coder.provider).toBe('fam-anthropic')
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
    expect(config.agents.coder.model).toBe('claude-opus-4')
    expect(config.agents.task.model).toBe('claude-haiku-4-5')
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
    expect(config.providers['fam-anthropic']).toBeDefined()
    expect(config.providers['fam-openai-task']).toBeDefined()
    expect(config.providers['fam-openai-task'].apiKey).toBe('sk-openai')
    expect(config.agents.task.provider).toBe('fam-openai-task')
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
    expect(config.providers['fam-openai_compatible'].baseURL).toBe('http://localhost:11434/v1')
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
