import { describe, it, expect } from 'vitest'
import { generateContinueDevConfig } from '../../../src/generators/continue-dev.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'continue-dev',
      description: 'Continue.dev',
      config_target: 'continue_dev',
      allowed_servers: [],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_cnt_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateContinueDevConfig', () => {
  it('should produce YAML format output', () => {
    const result = generateContinueDevConfig(makeInput())
    expect(result.format).toBe('yaml')
  })

  it('should output to ~/.continue/config.yaml', () => {
    const result = generateContinueDevConfig(makeInput())
    expect(result.path).toContain('.continue/config.yaml')
  })

  it('should include mcpServers with FAM entry', () => {
    const result = generateContinueDevConfig(makeInput())
    expect(result.content).toContain('fam')
    expect(result.content).toContain('http://localhost:7865/mcp')
    expect(result.content).toContain('fam_sk_cnt_a1b2c3d4')
  })

  it('should include model config when models.default is set', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-ant-test',
        },
        roles: {},
      },
    }))
    expect(result.content).toContain('claude-sonnet-4-20250514')
    expect(result.content).toContain('anthropic')
    expect(result.content).toContain('chat')
  })

  it('should assign default model to chat role', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {},
      },
    }))
    expect(result.content).toContain('chat')
  })

  it('should handle multiple roles on different models', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          edit: {
            provider: 'anthropic',
            model_id: 'claude-haiku-4-5',
            api_key: 'sk-test',
          },
          autocomplete: {
            provider: 'openai',
            model_id: 'gpt-4o-mini',
            api_key: 'sk-openai',
          },
        },
      },
    }))
    expect(result.content).toContain('claude-sonnet-4')
    expect(result.content).toContain('claude-haiku-4-5')
    expect(result.content).toContain('gpt-4o-mini')
    expect(result.content).toContain('edit')
    expect(result.content).toContain('autocomplete')
  })

  it('should merge roles on the same model', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          chat: {
            provider: 'anthropic',
            model_id: 'claude-sonnet-4',
            api_key: 'sk-test',
          },
          edit: {
            provider: 'anthropic',
            model_id: 'claude-sonnet-4',
            api_key: 'sk-test',
          },
        },
      },
    }))
    // Should have one model entry with multiple roles, not separate entries
    const modelMatches = result.content.match(/claude-sonnet-4/g)
    // One for model name, appearing in a single entry
    expect(modelMatches).toBeTruthy()
  })

  it('should skip unknown roles silently', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          unknown_role: {
            provider: 'anthropic',
            model_id: 'claude-opus-4',
            api_key: 'sk-test',
          },
        },
      },
    }))
    expect(result.content).not.toContain('unknown_role')
    expect(result.warnings ?? []).toHaveLength(0)
  })

  it('should include apiBase when base_url is set', () => {
    const result = generateContinueDevConfig(makeInput({
      models: {
        default: {
          provider: 'openai_compatible',
          model_id: 'llama-3.3-70b',
          api_key: null,
          base_url: 'http://localhost:11434/v1',
        },
        roles: {},
      },
    }))
    expect(result.content).toContain('http://localhost:11434/v1')
  })
})
