import { describe, it, expect } from 'vitest'
import { generateGithubCopilotConfig } from '../../../src/generators/github-copilot.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'github-copilot',
      description: 'GitHub Copilot agent',
      config_target: '~/.copilot/mcp-config.json',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_ghcp_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateGithubCopilotConfig', () => {
  it('should produce valid JSON output', () => {
    const result = generateGithubCopilotConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should contain mcpServers.fam with correct URL', () => {
    const result = generateGithubCopilotConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers.fam).toBeDefined()
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should include the token in the Authorization header', () => {
    const result = generateGithubCopilotConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.headers.Authorization).toBe(
      'Bearer fam_sk_ghcp_a1b2c3d4'
    )
  })

  it('should set transport to sse', () => {
    const result = generateGithubCopilotConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.transport).toBe('sse')
  })

  it('should expand tilde in the output path', () => {
    const result = generateGithubCopilotConfig(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.copilot/mcp-config.json')
  })

  it('should report format as json', () => {
    const result = generateGithubCopilotConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateGithubCopilotConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers.fam.url).toBe('http://localhost:7865/mcp')
  })
})
