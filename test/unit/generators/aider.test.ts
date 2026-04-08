import { describe, it, expect } from 'vitest'
import { generateAiderConfig } from '../../../src/generators/aider.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'aider',
      description: 'Aider CLI',
      config_target: 'aider',
      allowed_servers: [],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_aid_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateAiderConfig', () => {
  it('should produce YAML format output', () => {
    const result = generateAiderConfig(makeInput())
    expect(result.format).toBe('yaml')
  })

  it('should output to ~/.aider.conf.yml', () => {
    const result = generateAiderConfig(makeInput())
    expect(result.path).toContain('.aider.conf.yml')
  })

  it('should produce minimal config when no models', () => {
    const result = generateAiderConfig(makeInput())
    expect(result.content).toContain('# Aider config managed by FAM')
    expect(result.content).not.toContain('model:')
  })

  it('should include model line when models.default is set', () => {
    const result = generateAiderConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-test',
        },
        roles: {},
      },
    }))
    expect(result.content).toContain('model: anthropic/claude-sonnet-4-20250514')
  })

  it('should include editor-model when editor role is set', () => {
    const result = generateAiderConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-test',
        },
        roles: {
          editor: {
            provider: 'anthropic',
            model_id: 'claude-haiku-4-5-20251001',
            api_key: 'sk-test',
          },
        },
      },
    }))
    expect(result.content).toContain('editor-model: anthropic/claude-haiku-4-5-20251001')
  })

  it('should include weak-model when weak role is set', () => {
    const result = generateAiderConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-test',
        },
        roles: {
          weak: {
            provider: 'openai',
            model_id: 'gpt-4o-mini',
            api_key: 'sk-openai',
          },
        },
      },
    }))
    expect(result.content).toContain('weak-model: openai/gpt-4o-mini')
  })

  it('should include base_url as openai-api-base', () => {
    const result = generateAiderConfig(makeInput({
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
    expect(result.content).toContain('openai-api-base: http://localhost:11434/v1')
  })

  it('should emit API key warning for anthropic provider', () => {
    const result = generateAiderConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-ant-test',
        },
        roles: {},
      },
    }))
    expect(result.warnings).toBeDefined()
    expect(result.warnings![0]).toContain('ANTHROPIC_API_KEY')
  })
})
