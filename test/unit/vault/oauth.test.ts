/**
 * test/unit/vault/oauth.test.ts — OAuth manager unit tests.
 *
 * Tests OAuthManager with a mock vault. Does not test the
 * actual browser flow (that requires real HTTP + browser).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OAuthManager } from '../../../src/vault/oauth.js'
import type { TokenStatus } from '../../../src/vault/oauth.js'
import type { CredentialVault } from '../../../src/vault/types.js'
import type { FamConfig } from '../../../src/config/types.js'

// ─── Mock Vault ──────────────────────────────────────────────────

function createMockVault(store: Record<string, string> = {}): CredentialVault {
  return {
    get: vi.fn(async (name: string) => store[name] ?? null),
    set: vi.fn(async (name: string, value: string) => {
      store[name] = value
    }),
    delete: vi.fn(async (name: string) => {
      delete store[name]
    }),
    exists: vi.fn(async (name: string) => name in store),
    list: vi.fn(async () => []),
  }
}

// ─── Minimal FamConfig ───────────────────────────────────────────

function createConfig(credentials: Record<string, unknown> = {}): FamConfig {
  return {
    version: '1',
    settings: {
      daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    credentials: credentials as FamConfig['credentials'],
    mcp_servers: {},
    profiles: {},
    generators: {},
    native_tools: {},
    instructions: { enabled: true, output_dir: '~/.fam/instructions/' },
  }
}

describe('OAuthManager', () => {
  let vault: CredentialVault
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vault = createMockVault(store)
  })

  // ─── getValidToken ───────────────────────────────────────────

  describe('getValidToken', () => {
    it('should return stored access token when not expired', async () => {
      store['my-oauth:access'] = 'token-abc'
      const futureExpiry = new Date(Date.now() + 3600_000).toISOString()
      store['my-oauth:expires'] = futureExpiry

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      const token = await mgr.getValidToken('my-oauth')
      expect(token).toBe('token-abc')
    })

    it('should return stored access token when no expiry is set', async () => {
      store['my-oauth:access'] = 'token-no-expiry'

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      const token = await mgr.getValidToken('my-oauth')
      expect(token).toBe('token-no-expiry')
    })

    it('should throw when no access token exists', async () => {
      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.getValidToken('my-oauth')).rejects.toThrow('No access token')
    })

    it('should throw for wrong credential type', async () => {
      const config = createConfig({
        'api-key-cred': {
          type: 'api_key',
          description: 'Not oauth',
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.getValidToken('api-key-cred')).rejects.toThrow("not 'oauth2'")
    })

    it('should throw for unknown credential', async () => {
      const config = createConfig({})
      const mgr = new OAuthManager(vault, config)
      await expect(mgr.getValidToken('nonexistent')).rejects.toThrow('not found')
    })
  })

  // ─── getTokenStatus ──────────────────────────────────────────

  describe('getTokenStatus', () => {
    it('should report no tokens when nothing is stored', async () => {
      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      const status = await mgr.getTokenStatus('my-oauth')
      expect(status.hasAccessToken).toBe(false)
      expect(status.hasRefreshToken).toBe(false)
      expect(status.isExpired).toBe(false)
      expect(status.expiresAt).toBeUndefined()
    })

    it('should report stored tokens correctly', async () => {
      store['my-oauth:access'] = 'token'
      store['my-oauth:refresh'] = 'refresh-token'
      const future = new Date(Date.now() + 3600_000).toISOString()
      store['my-oauth:expires'] = future

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      const status = await mgr.getTokenStatus('my-oauth')
      expect(status.hasAccessToken).toBe(true)
      expect(status.hasRefreshToken).toBe(true)
      expect(status.isExpired).toBe(false)
      expect(status.expiresAt).toBe(future)
    })

    it('should detect expired tokens', async () => {
      store['my-oauth:access'] = 'expired-token'
      const past = new Date(Date.now() - 3600_000).toISOString()
      store['my-oauth:expires'] = past

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      const status = await mgr.getTokenStatus('my-oauth')
      expect(status.hasAccessToken).toBe(true)
      expect(status.isExpired).toBe(true)
    })
  })

  // ─── forceRefresh ────────────────────────────────────────────

  describe('forceRefresh', () => {
    it('should throw when no refresh token exists', async () => {
      store['my-oauth:access'] = 'token'

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.forceRefresh('my-oauth')).rejects.toThrow('No refresh token')
    })

    it('should throw when no client_secret exists', async () => {
      store['my-oauth:access'] = 'token'
      store['my-oauth:refresh'] = 'refresh'

      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.forceRefresh('my-oauth')).rejects.toThrow('Client secret')
    })
  })

  // ─── initiateFlow validation ─────────────────────────────────

  describe('initiateFlow', () => {
    it('should throw for unknown credential', async () => {
      const config = createConfig({})
      const mgr = new OAuthManager(vault, config)
      await expect(mgr.initiateFlow('nonexistent')).rejects.toThrow('not found')
    })

    it('should throw for non-oauth2 credential', async () => {
      const config = createConfig({
        'api-key': {
          type: 'api_key',
          description: 'Not oauth',
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.initiateFlow('api-key')).rejects.toThrow("not 'oauth2'")
    })

    it('should throw for unknown provider', async () => {
      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'unknown-provider',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.initiateFlow('my-oauth')).rejects.toThrow('Unknown OAuth provider')
    })

    it('should throw when client_secret is missing', async () => {
      const config = createConfig({
        'my-oauth': {
          type: 'oauth2',
          description: 'Test',
          provider: 'github',
          client_id: 'test-id',
          scopes: ['read'],
        },
      })

      const mgr = new OAuthManager(vault, config)
      await expect(mgr.initiateFlow('my-oauth')).rejects.toThrow('Client secret')
    })
  })
})
