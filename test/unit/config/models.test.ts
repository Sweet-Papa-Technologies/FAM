import { describe, it, expect } from 'vitest'
import { parseModelRef, resolveModelRef, resolveProfileModels } from '../../../src/config/models.js'
import type { FamConfig } from '../../../src/config/types.js'
import type { CredentialVault } from '../../../src/vault/types.js'

// ─── Mock Vault ────────────────────────────────────────────────────

function mockVault(store: Record<string, string> = {}): CredentialVault {
  return {
    async get(name: string) { return store[name] ?? null },
    async set(name: string, value: string) { store[name] = value },
    async delete(name: string) { delete store[name] },
    async exists(name: string) { return name in store },
    async list() { return [] },
  }
}

// ─── Config Fixture ────────────────────────────────────────────────

function makeConfig(overrides?: Partial<FamConfig>): FamConfig {
  return {
    version: '0.1',
    settings: {
      daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    credentials: {
      'anthropic-key': { type: 'api_key', description: 'Anthropic API Key' },
      'openai-key': { type: 'api_key', description: 'OpenAI API Key' },
    },
    models: {
      anthropic: {
        provider: 'anthropic',
        credential: 'anthropic-key',
        models: {
          sonnet: 'claude-sonnet-4-20250514',
          opus: 'claude-opus-4-20250514',
          haiku: 'claude-haiku-4-5-20251001',
        },
      },
      local: {
        provider: 'openai_compatible',
        credential: null,
        base_url: 'http://localhost:11434/v1',
        models: {
          llama: 'llama-3.3-70b',
        },
      },
    },
    mcp_servers: {},
    profiles: {
      'claude-code': {
        description: 'Claude Code',
        config_target: 'claude_code',
        model: 'anthropic/sonnet',
        model_roles: {
          sonnet_tier: 'anthropic/sonnet',
          opus_tier: 'anthropic/opus',
          haiku_tier: 'anthropic/haiku',
        },
        allowed_servers: [],
        denied_servers: [],
      },
      'no-model': {
        description: 'No model',
        config_target: 'generic',
        allowed_servers: [],
        denied_servers: [],
      },
      'bare-model': {
        description: 'Bare string model',
        config_target: 'generic',
        model: 'claude-sonnet-4',
        allowed_servers: [],
        denied_servers: [],
      },
    },
    generators: {},
    native_tools: {},
    instructions: { enabled: true, output_dir: '~/.fam/instructions/' },
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('parseModelRef', () => {
  it('should parse provider/alias format', () => {
    const result = parseModelRef('anthropic/sonnet')
    expect(result).toEqual({ provider: 'anthropic', alias: 'sonnet' })
  })

  it('should return null for bare string (no slash)', () => {
    const result = parseModelRef('claude-sonnet-4')
    expect(result).toBeNull()
  })

  it('should handle provider with hyphen', () => {
    const result = parseModelRef('my-provider/my-model')
    expect(result).toEqual({ provider: 'my-provider', alias: 'my-model' })
  })

  it('should return null for empty string', () => {
    const result = parseModelRef('')
    expect(result).toBeNull()
  })

  it('should return null for slash with empty provider', () => {
    const result = parseModelRef('/sonnet')
    expect(result).toBeNull()
  })

  it('should return null for slash with empty alias', () => {
    const result = parseModelRef('anthropic/')
    expect(result).toBeNull()
  })
})

describe('resolveModelRef', () => {
  it('should resolve a valid provider/alias reference', async () => {
    const config = makeConfig()
    const vault = mockVault({ 'anthropic-key': 'sk-ant-test123' })
    const cache = new Map<string, string | null>()

    const result = await resolveModelRef('anthropic/sonnet', config, vault, cache)
    expect(result).toEqual({
      provider: 'anthropic',
      model_id: 'claude-sonnet-4-20250514',
      api_key: 'sk-ant-test123',
    })
  })

  it('should return null for bare string reference', async () => {
    const config = makeConfig()
    const vault = mockVault()
    const cache = new Map<string, string | null>()

    const result = await resolveModelRef('claude-sonnet-4', config, vault, cache)
    expect(result).toBeNull()
  })

  it('should throw for unknown provider', async () => {
    const config = makeConfig()
    const vault = mockVault()
    const cache = new Map<string, string | null>()

    await expect(
      resolveModelRef('unknown/model', config, vault, cache)
    ).rejects.toThrow('Unknown model provider "unknown"')
  })

  it('should throw for unknown alias', async () => {
    const config = makeConfig()
    const vault = mockVault()
    const cache = new Map<string, string | null>()

    await expect(
      resolveModelRef('anthropic/nonexistent', config, vault, cache)
    ).rejects.toThrow('Unknown model alias "nonexistent"')
  })

  it('should return null api_key when credential is null', async () => {
    const config = makeConfig()
    const vault = mockVault()
    const cache = new Map<string, string | null>()

    const result = await resolveModelRef('local/llama', config, vault, cache)
    expect(result).toEqual({
      provider: 'openai_compatible',
      model_id: 'llama-3.3-70b',
      api_key: null,
      base_url: 'http://localhost:11434/v1',
    })
  })

  it('should include base_url when provider has one', async () => {
    const config = makeConfig()
    const vault = mockVault()
    const cache = new Map<string, string | null>()

    const result = await resolveModelRef('local/llama', config, vault, cache)
    expect(result?.base_url).toBe('http://localhost:11434/v1')
  })

  it('should cache credential lookups', async () => {
    const config = makeConfig()
    let callCount = 0
    const vault: CredentialVault = {
      async get(name: string) {
        callCount++
        return name === 'anthropic-key' ? 'sk-test' : null
      },
      async set() {},
      async delete() {},
      async exists() { return false },
      async list() { return [] },
    }
    const cache = new Map<string, string | null>()

    await resolveModelRef('anthropic/sonnet', config, vault, cache)
    await resolveModelRef('anthropic/opus', config, vault, cache)

    // Should only call vault.get once for 'anthropic-key', second call uses cache
    expect(callCount).toBe(1)
  })
})

describe('resolveProfileModels', () => {
  it('should resolve a profile with default model and roles', async () => {
    const config = makeConfig()
    const vault = mockVault({ 'anthropic-key': 'sk-ant-test' })

    const result = await resolveProfileModels('claude-code', config, vault)
    expect(result).not.toBeNull()
    expect(result!.default.model_id).toBe('claude-sonnet-4-20250514')
    expect(result!.default.api_key).toBe('sk-ant-test')
    expect(result!.roles.sonnet_tier.model_id).toBe('claude-sonnet-4-20250514')
    expect(result!.roles.opus_tier.model_id).toBe('claude-opus-4-20250514')
    expect(result!.roles.haiku_tier.model_id).toBe('claude-haiku-4-5-20251001')
  })

  it('should return null for profile with no model', async () => {
    const config = makeConfig()
    const vault = mockVault()

    const result = await resolveProfileModels('no-model', config, vault)
    expect(result).toBeNull()
  })

  it('should return null for profile with bare string model', async () => {
    const config = makeConfig()
    const vault = mockVault()

    const result = await resolveProfileModels('bare-model', config, vault)
    expect(result).toBeNull()
  })

  it('should return null for nonexistent profile', async () => {
    const config = makeConfig()
    const vault = mockVault()

    const result = await resolveProfileModels('nonexistent', config, vault)
    expect(result).toBeNull()
  })

  it('should use first role as default when no explicit default model', async () => {
    const config = makeConfig({
      profiles: {
        'roles-only': {
          description: 'Roles only',
          config_target: 'generic',
          model_roles: { coder: 'anthropic/opus' },
          allowed_servers: [],
          denied_servers: [],
        },
      },
    })
    const vault = mockVault({ 'anthropic-key': 'sk-test' })

    const result = await resolveProfileModels('roles-only', config, vault)
    expect(result).not.toBeNull()
    expect(result!.default.model_id).toBe('claude-opus-4-20250514')
  })
})
