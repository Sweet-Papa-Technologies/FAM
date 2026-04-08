import { describe, it, expect } from 'vitest'
import { generateOpenClawConfig, generateOpenClawModelsYaml } from '../../../src/generators/openclaw.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'openclaw',
      description: 'OpenClaw agent',
      config_target: 'openclaw',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_ocw_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateOpenClawConfig', () => {
  it('should produce valid JSON', () => {
    const result = generateOpenClawConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should output to ~/.openclaw/openclaw.json', () => {
    const result = generateOpenClawConfig(makeInput())
    expect(result.path).toContain('.openclaw/openclaw.json')
  })

  it('should include mcpServers.fam with correct URL', () => {
    const result = generateOpenClawConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
    expect(parsed.mcpServers.fam.headers.Authorization).toBe('Bearer fam_sk_ocw_a1b2c3d4')
  })

  it('should not include models section when no models configured', () => {
    const result = generateOpenClawConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.models).toBeUndefined()
  })

  it('should include model providers when models.default is set', () => {
    const result = generateOpenClawConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-ant-test',
        },
        roles: {},
      },
    }))
    const parsed = JSON.parse(result.content)
    expect(parsed.models.providers.anthropic).toBeDefined()
    expect(parsed.models.providers.anthropic.api).toBe('anthropic-messages')
    expect(parsed.models.providers.anthropic.apiKey).toBe('sk-ant-test')
  })

  it('should use openai-completions api type for openai_compatible', () => {
    const result = generateOpenClawConfig(makeInput({
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
    const parsed = JSON.parse(result.content)
    expect(parsed.models.providers.openai.api).toBe('openai-completions')
    expect(parsed.models.providers.openai.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('should add cross-provider models from roles', () => {
    const result = generateOpenClawConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-ant',
        },
        roles: {
          economy: {
            provider: 'openai',
            model_id: 'gpt-4o-mini',
            api_key: 'sk-openai',
          },
        },
      },
    }))
    const parsed = JSON.parse(result.content)
    expect(parsed.models.providers.anthropic).toBeDefined()
    expect(parsed.models.providers.openai).toBeDefined()
    expect(parsed.models.providers.openai.apiKey).toBe('sk-openai')
  })
})

describe('generateOpenClawModelsYaml', () => {
  it('should return null when no models configured', () => {
    const result = generateOpenClawModelsYaml(makeInput())
    expect(result).toBeNull()
  })

  it('should produce YAML with primary tier', () => {
    const result = generateOpenClawModelsYaml(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-test',
        },
        roles: {},
      },
    }))
    expect(result).not.toBeNull()
    expect(result!.format).toBe('yaml')
    expect(result!.path).toContain('models.yaml')
    expect(result!.content).toContain('primary:')
    expect(result!.content).toContain('anthropic/claude-sonnet-4-20250514')
    expect(result!.content).toContain('max_tokens: 8192')
  })

  it('should include fallback tier when fallback role is set', () => {
    const result = generateOpenClawModelsYaml(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          fallback: {
            provider: 'openai',
            model_id: 'gpt-4o',
            api_key: 'sk-openai',
          },
        },
      },
    }))
    expect(result!.content).toContain('fallback:')
    expect(result!.content).toContain('openai/gpt-4o')
    expect(result!.content).toContain('max_tokens: 4096')
  })

  it('should include economy tier when economy role is set', () => {
    const result = generateOpenClawModelsYaml(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          economy: {
            provider: 'anthropic',
            model_id: 'claude-haiku-4-5',
            api_key: 'sk-test',
          },
        },
      },
    }))
    expect(result!.content).toContain('economy:')
    expect(result!.content).toContain('anthropic/claude-haiku-4-5')
    expect(result!.content).toContain('max_tokens: 2048')
    expect(result!.content).toContain('temperature: 0.2')
  })

  it('should include all three tiers when all roles are set', () => {
    const result = generateOpenClawModelsYaml(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {
          fallback: {
            provider: 'openai',
            model_id: 'gpt-4o',
            api_key: 'sk-openai',
          },
          economy: {
            provider: 'anthropic',
            model_id: 'claude-haiku-4-5',
            api_key: 'sk-test',
          },
        },
      },
    }))
    expect(result!.content).toContain('primary:')
    expect(result!.content).toContain('fallback:')
    expect(result!.content).toContain('economy:')
  })
})
