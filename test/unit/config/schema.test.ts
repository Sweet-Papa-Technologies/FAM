import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { FamConfigSchema, CredentialSchema } from '../../../src/config/schema.js'

const FIXTURES = resolve(import.meta.dirname, '../../fixtures')

function loadYaml(relativePath: string): unknown {
  const raw = readFileSync(resolve(FIXTURES, relativePath), 'utf-8')
  return parseYaml(raw)
}

describe('FamConfigSchema', () => {
  it('should parse valid-config.yaml without errors', () => {
    const data = loadYaml('valid-config.yaml')
    const result = FamConfigSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.version).toBe('0.1')
      expect(Object.keys(result.data.credentials)).toContain('github-pat')
      expect(Object.keys(result.data.mcp_servers)).toContain('github')
      expect(Object.keys(result.data.profiles)).toContain('claude-code')
    }
  })

  it('should parse minimal-config.yaml without errors', () => {
    const data = loadYaml('minimal-config.yaml')
    const result = FamConfigSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.version).toBe('0.1')
      expect(Object.keys(result.data.profiles)).toContain('default')
    }
  })

  it('should apply default values on minimal config', () => {
    const data = loadYaml('minimal-config.yaml')
    const result = FamConfigSchema.parse(data)

    // Settings defaults
    expect(result.settings.daemon.port).toBe(7865)
    expect(result.settings.daemon.socket).toBe('~/.fam/agent.sock')
    expect(result.settings.daemon.auto_start).toBe(true)
    expect(result.settings.audit.enabled).toBe(true)
    expect(result.settings.audit.retention_days).toBe(90)
    expect(result.settings.audit.export_format).toBe('json')

    // Empty record defaults
    expect(result.credentials).toEqual({})
    expect(result.mcp_servers).toEqual({})
    expect(result.generators).toEqual({})
    expect(result.native_tools).toEqual({})

    // Instructions defaults
    expect(result.instructions.enabled).toBe(true)
    expect(result.instructions.output_dir).toBe('~/.fam/instructions/')

    // Profile defaults
    expect(result.profiles.default.denied_servers).toEqual([])
  })

  it('should fail validation for missing-profiles.yaml', () => {
    const data = loadYaml('invalid-configs/missing-profiles.yaml')
    const result = FamConfigSchema.safeParse(data)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('profiles')
    }
  })

  it('should fail validation for invalid-transport.yaml', () => {
    const data = loadYaml('invalid-configs/invalid-transport.yaml')
    const result = FamConfigSchema.safeParse(data)
    expect(result.success).toBe(false)
    if (!result.success) {
      // The union should fail because 'websocket' is not a valid transport
      const hasServerError = result.error.issues.some((i) =>
        i.path.some((p) => p === 'mcp_servers' || p === 'test'),
      )
      expect(hasServerError).toBe(true)
    }
  })
})

describe('CredentialSchema (discriminatedUnion)', () => {
  it('should accept api_key credentials', () => {
    const result = CredentialSchema.safeParse({
      type: 'api_key',
      description: 'Test API key',
      env_var: 'TEST_KEY',
      rotate_after_days: 30,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('api_key')
      if (result.data.type === 'api_key') {
        expect(result.data.env_var).toBe('TEST_KEY')
        expect(result.data.rotate_after_days).toBe(30)
      }
    }
  })

  it('should accept oauth2 credentials', () => {
    const result = CredentialSchema.safeParse({
      type: 'oauth2',
      description: 'Test OAuth',
      provider: 'google',
      client_id: 'abc123',
      scopes: ['read', 'write'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('oauth2')
      if (result.data.type === 'oauth2') {
        expect(result.data.provider).toBe('google')
        expect(result.data.scopes).toEqual(['read', 'write'])
      }
    }
  })

  it('should reject unknown credential types', () => {
    const result = CredentialSchema.safeParse({
      type: 'bearer_token',
      description: 'Unknown type',
    })
    expect(result.success).toBe(false)
  })

  it('should reject api_key missing description', () => {
    const result = CredentialSchema.safeParse({
      type: 'api_key',
    })
    expect(result.success).toBe(false)
  })

  it('should reject oauth2 missing required fields', () => {
    const result = CredentialSchema.safeParse({
      type: 'oauth2',
      description: 'Missing provider',
    })
    expect(result.success).toBe(false)
  })
})
