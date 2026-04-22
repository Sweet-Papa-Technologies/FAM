import { describe, it, expect } from 'vitest'
import { generateClaudeCodeConfig } from '../../../src/generators/claude-code.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'claude-code',
      description: 'Claude Code agent',
      config_target: '~/.claude.json',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_cld_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

// Helper: parse the settings.json additionalFile if present
function getSettingsJson(result: ReturnType<typeof generateClaudeCodeConfig>) {
  const extra = (result.additionalFiles ?? []).find(f => f.path.endsWith('.claude/settings.json'))
  return extra ? JSON.parse(extra.content) : null
}

describe('Claude Code model config', () => {
  it('should not emit a settings.json when no models configured', () => {
    const result = generateClaudeCodeConfig(makeInput())
    expect(result.additionalFiles).toBeUndefined()
  })

  it('should emit settings.json with env block when models.default is set', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-ant-test123',
        },
        roles: {},
      },
    }))
    const settings = getSettingsJson(result)
    expect(settings).toBeTruthy()
    expect(settings.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-20250514')
    expect(settings.env.ANTHROPIC_API_KEY).toBe('sk-ant-test123')
  })

  it('should include ANTHROPIC_BASE_URL when base_url is set', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
          base_url: 'https://proxy.example.com/v1',
        },
        roles: {},
      },
    }))
    const settings = getSettingsJson(result)
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com/v1')
  })

  it('should set tier-specific model env vars from roles', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-test',
        },
        roles: {
          sonnet_tier: { provider: 'anthropic', model_id: 'claude-sonnet-4-20250514', api_key: 'sk-test' },
          opus_tier: { provider: 'anthropic', model_id: 'claude-opus-4-20250514', api_key: 'sk-test' },
          haiku_tier: { provider: 'anthropic', model_id: 'claude-haiku-4-5-20251001', api_key: 'sk-test' },
        },
      },
    }))
    const settings = getSettingsJson(result)
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-20250514')
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-20250514')
    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5-20251001')
  })

  it('should let env_inject override model-derived env vars', () => {
    const result = generateClaudeCodeConfig(makeInput({
      profile: {
        name: 'claude-code',
        description: 'Claude Code agent',
        config_target: '~/.claude.json',
        allowed_servers: [],
        denied_servers: [],
        env_inject: {
          ANTHROPIC_MODEL: 'custom-model-override',
        },
      },
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {},
      },
    }))
    const settings = getSettingsJson(result)
    expect(settings.env.ANTHROPIC_MODEL).toBe('custom-model-override')
  })

  it('should always include mcpServers in the primary file regardless of model config', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-test',
        },
        roles: {},
      },
    }))
    const main = JSON.parse(result.content)
    expect(main.mcpServers).toBeDefined()
    expect(main.mcpServers.fam).toBeDefined()
    // settings.json is a separate file, not merged into primary
    expect(main.env).toBeUndefined()
  })

  it('should skip env block and warn for non-Anthropic providers', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'openai_compatible',
          model_id: 'gemma4:26b',
          api_key: null,
          base_url: 'http://192.168.1.99:11434/v1',
        },
        roles: {},
      },
    }))
    // No settings.json generated
    expect(result.additionalFiles).toBeUndefined()
    // MCP servers still configured in primary
    const main = JSON.parse(result.content)
    expect(main.mcpServers.fam).toBeDefined()
    // Warning emitted
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.length).toBeGreaterThan(0)
    expect(result.warnings![0]).toContain('openai_compatible')
    expect(result.warnings![0]).toContain('Claude Code only supports Anthropic models')
  })

  it('should allow amazon_bedrock as compatible provider', () => {
    const result = generateClaudeCodeConfig(makeInput({
      models: {
        default: {
          provider: 'amazon_bedrock',
          model_id: 'anthropic.claude-3-sonnet-20240229-v1:0',
          api_key: 'bedrock-key',
        },
        roles: {},
      },
    }))
    const settings = getSettingsJson(result)
    expect(settings).toBeTruthy()
    expect(settings.env.ANTHROPIC_MODEL).toBe('anthropic.claude-3-sonnet-20240229-v1:0')
    expect(result.warnings).toBeUndefined()
  })
})
