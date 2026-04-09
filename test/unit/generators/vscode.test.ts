import { describe, it, expect } from 'vitest'
import { generateVSCodeConfig } from '../../../src/generators/vscode.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'vscode',
      description: 'VS Code Copilot agent',
      config_target: '.vscode/mcp.json',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_vsc_i9j0k1l2',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateVSCodeConfig', () => {
  it('should produce valid JSON output', () => {
    const result = generateVSCodeConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should use "servers" key instead of "mcpServers"', () => {
    const result = generateVSCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.servers).toBeDefined()
    expect(parsed.mcpServers).toBeUndefined()
  })

  it('should use "type": "sse" instead of "transport"', () => {
    const result = generateVSCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.servers.fam.type).toBe('http')
    expect(parsed.servers.fam.transport).toBeUndefined()
  })

  it('should contain the correct URL', () => {
    const result = generateVSCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.servers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should include the token in the Authorization header', () => {
    const result = generateVSCodeConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.servers.fam.headers.Authorization).toBe(
      'Bearer fam_sk_vsc_i9j0k1l2'
    )
  })

  it('should report format as json', () => {
    const result = generateVSCodeConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateVSCodeConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.servers.fam.url).toBe('http://localhost:7865/mcp')
  })
})
