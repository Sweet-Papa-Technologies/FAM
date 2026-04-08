import { describe, it, expect } from 'vitest'
import { generateNemoClawConfig } from '../../../src/generators/nemoclaw.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'nemoclaw',
      description: 'NemoClaw agent',
      config_target: 'nemoclaw',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_nmc_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateNemoClawConfig', () => {
  it('should produce valid JSON', () => {
    const result = generateNemoClawConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should output to ~/.nemoclaw/openclaw.json', () => {
    const result = generateNemoClawConfig(makeInput())
    expect(result.path).toContain('.nemoclaw/openclaw.json')
  })

  it('should include mcpServers.fam with correct URL', () => {
    const result = generateNemoClawConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
    expect(parsed.mcpServers.fam.headers.Authorization).toBe('Bearer fam_sk_nmc_a1b2c3d4')
  })

  it('should not emit warnings when no models configured', () => {
    const result = generateNemoClawConfig(makeInput())
    expect(result.warnings).toBeUndefined()
  })

  it('should emit onboard command warning with model config', () => {
    const result = generateNemoClawConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4-20250514',
          api_key: 'sk-ant-test',
        },
        roles: {},
      },
    }))
    expect(result.warnings).toBeDefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings![0]).toContain('NEMOCLAW_PROVIDER=custom')
    expect(result.warnings![0]).toContain('NEMOCLAW_MODEL=claude-sonnet-4-20250514')
    expect(result.warnings![0]).toContain('nemoclaw onboard --non-interactive')
  })

  it('should include endpoint URL for custom base_url', () => {
    const result = generateNemoClawConfig(makeInput({
      models: {
        default: {
          provider: 'openai_compatible',
          model_id: 'llama-3.3-70b',
          api_key: null,
          base_url: 'http://localhost:8000/v1',
        },
        roles: {},
      },
    }))
    expect(result.warnings![0]).toContain('NEMOCLAW_ENDPOINT_URL=http://localhost:8000/v1')
  })

  it('should include default anthropic endpoint URL', () => {
    const result = generateNemoClawConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-ant',
        },
        roles: {},
      },
    }))
    expect(result.warnings![0]).toContain('NEMOCLAW_ENDPOINT_URL=https://api.anthropic.com/v1')
  })

  it('should mention API key in warning when credential exists', () => {
    const result = generateNemoClawConfig(makeInput({
      models: {
        default: {
          provider: 'anthropic',
          model_id: 'claude-sonnet-4',
          api_key: 'sk-ant-secret',
        },
        roles: {},
      },
    }))
    expect(result.warnings![0]).toContain('COMPATIBLE_API_KEY')
  })

  it('should use JSON format', () => {
    const result = generateNemoClawConfig(makeInput())
    expect(result.format).toBe('json')
  })
})
