import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateZedConfig } from '../../../src/generators/zed.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'zed',
      description: 'Zed agent',
      config_target: '',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_zed_a1b2c3d4',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateZedConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should produce valid JSON output', () => {
    const result = generateZedConfig(makeInput())
    expect(() => JSON.parse(result.content)).not.toThrow()
  })

  it('should contain context_servers.fam with correct URL', () => {
    const result = generateZedConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.context_servers).toBeDefined()
    expect(parsed.context_servers.fam).toBeDefined()
    expect(parsed.context_servers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should set source to custom', () => {
    const result = generateZedConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.context_servers.fam.source).toBeUndefined()
  })

  it('should include the token in the Authorization header', () => {
    const result = generateZedConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.context_servers.fam.headers.Authorization).toBe(
      'Bearer fam_sk_zed_a1b2c3d4'
    )
  })

  it('should use macOS path on darwin', () => {
    // On macOS (where these tests run), the default path should be the macOS one
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const result = generateZedConfig(makeInput())
    expect(result.path).toContain('Library/Application Support/Zed/settings.json')
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('should use Linux path on linux', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const result = generateZedConfig(makeInput())
    expect(result.path).toContain('.config/zed/settings.json')
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('should report format as json', () => {
    const result = generateZedConfig(makeInput())
    expect(result.format).toBe('json')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateZedConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    const parsed = JSON.parse(result.content)
    expect(parsed.context_servers.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('should not have mcpServers key', () => {
    const result = generateZedConfig(makeInput())
    const parsed = JSON.parse(result.content)
    expect(parsed.mcpServers).toBeUndefined()
  })
})
