import { describe, it, expect } from 'vitest'
import { generateGenericConfig } from '../../../src/generators/generic.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'paperclip',
      description: 'Paperclip agent',
      config_target: '',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_ppr_q7r8s9t0',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateGenericConfig', () => {
  it('should produce valid JSON output', () => {
    const result = generateGenericConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should contain the profile name', () => {
    const result = generateGenericConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.profile).toBe('paperclip')
  })

  it('should contain the MCP endpoint', () => {
    const result = generateGenericConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcp_endpoint).toBe('http://localhost:7865/mcp')
  })

  it('should contain the session token', () => {
    const result = generateGenericConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.token).toBe('fam_sk_ppr_q7r8s9t0')
  })

  it('should set transport to sse', () => {
    const result = generateGenericConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.transport).toBe('sse')
  })

  it('should default output path to ~/.fam/configs/<profile>.json', () => {
    const result = generateGenericConfig(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.fam/configs/paperclip.json')
  })

  it('should report format as json', () => {
    const result = generateGenericConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateGenericConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.mcp_endpoint).toBe('http://localhost:7865/mcp')
  })
})
