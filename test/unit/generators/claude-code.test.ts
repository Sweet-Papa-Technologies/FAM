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

describe('generateClaudeCodeConfig', () => {
  it('should produce valid JSON output', () => {
    const result = generateClaudeCodeConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should contain mcpServers.fam with correct URL', () => {
    const result = generateClaudeCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should include the token in the Authorization header', () => {
    const result = generateClaudeCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.headers.Authorization).toBe(
      'Bearer fam_sk_cld_a1b2c3d4'
    )
  })

  it('should set transport to sse', () => {
    const result = generateClaudeCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.transport).toBe('sse')
  })

  it('should expand tilde in the output path', () => {
    const result = generateClaudeCodeConfig(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.claude/settings.json')
  })

  it('should report format as json', () => {
    const result = generateClaudeCodeConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateClaudeCodeConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })
})
