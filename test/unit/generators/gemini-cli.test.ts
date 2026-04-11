import { describe, it, expect } from 'vitest'
import { generateGeminiCliConfig } from '../../../src/generators/gemini-cli.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'gemini-cli',
      description: 'Gemini CLI agent',
      config_target: '~/.gemini/settings.json',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_gem_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateGeminiCliConfig', () => {
  it('should produce valid JSON output', () => {
    const result = generateGeminiCliConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should contain mcpServers.fam with correct URL', () => {
    const result = generateGeminiCliConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should include the token in the Authorization header', () => {
    const result = generateGeminiCliConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.headers.Authorization).toBe(
      'Bearer fam_sk_gem_a1b2c3d4'
    )
  })

  it('should not include transport field', () => {
    const result = generateGeminiCliConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.transport).toBeUndefined()
  })

  it('should expand tilde in the output path', () => {
    const result = generateGeminiCliConfig(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.gemini/settings.json')
  })

  it('should report format as json', () => {
    const result = generateGeminiCliConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateGeminiCliConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should include model config for Google provider', () => {
    const result = generateGeminiCliConfig(makeInput({
      models: {
        default: {
          provider: 'google',
          model_id: 'gemini-2.0-flash',
          api_key: 'google-key',
        },
        roles: {},
      },
    }))
    const parsed = JSON.parse(result.content)
    expect(parsed.model).toBeDefined()
    expect(parsed.model.name).toBe('gemini-2.0-flash')
  })

  it('should skip model config and warn for non-Google providers', () => {
    const result = generateGeminiCliConfig(makeInput({
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
    // Model should NOT be written
    expect(parsed.model).toBeUndefined()
    // MCP servers should still be configured
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    // Should emit a warning
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.length).toBeGreaterThan(0)
    expect(result.warnings![0]).toContain('openai_compatible')
    expect(result.warnings![0]).toContain('Gemini CLI only supports Google models')
  })
})
