import { describe, it, expect } from 'vitest'
import { generateClaudeCodeConfig } from '../../../src/generators/claude-code.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'claude-code',
      description: 'Claude Code agent',
      config_target: '~/.claude/settings.json',
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

describe('Claude Code model config', () => {
  it('should not include env block when no models', () => {
    const result = generateClaudeCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.env).toBeUndefined()
  })

  it('should include env block with model vars when models.default is set', () => {
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
    const parsed = JSON.parse(result.content)
    expect(parsed.env).toBeDefined()
    expect(parsed.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-20250514')
    expect(parsed.env.ANTHROPIC_API_KEY).toBe('sk-ant-test123')
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
    const parsed = JSON.parse(result.content)
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com/v1')
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
    const parsed = JSON.parse(result.content)
    expect(parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-20250514')
    expect(parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-20250514')
    expect(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5-20251001')
  })

  it('should let env_inject override model-derived env vars', () => {
    const result = generateClaudeCodeConfig(makeInput({
      profile: {
        name: 'claude-code',
        description: 'Claude Code agent',
        config_target: '~/.claude/settings.json',
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
    const parsed = JSON.parse(result.content)
    // env_inject should win over model-derived value
    expect(parsed.env.ANTHROPIC_MODEL).toBe('custom-model-override')
  })

  it('should still include mcpServers alongside env block', () => {
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
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    expect(parsed.env).toBeDefined()
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
    const parsed = JSON.parse(result.content)
    // Model env vars should NOT be written
    expect(parsed.env).toBeUndefined()
    // MCP servers should still be configured
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    // Should emit a warning
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
    const parsed = JSON.parse(result.content)
    expect(parsed.env).toBeDefined()
    expect(parsed.env.ANTHROPIC_MODEL).toBe('anthropic.claude-3-sonnet-20240229-v1:0')
    expect(result.warnings).toBeUndefined()
  })
})
