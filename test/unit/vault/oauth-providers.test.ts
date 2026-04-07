/**
 * test/unit/vault/oauth-providers.test.ts — Provider registry unit tests.
 *
 * Validates the known provider configurations, lookup helpers,
 * and edge cases for unknown providers.
 */

import { describe, it, expect } from 'vitest'
import {
  OAUTH_PROVIDERS,
  getProviderConfig,
  listProviders,
} from '../../../src/vault/oauth-providers.js'
import type { OAuthProviderConfig } from '../../../src/vault/oauth-providers.js'

describe('OAuth Provider Registry', () => {
  // ─── Known Providers ──────────────────────────────────────────

  describe('OAUTH_PROVIDERS', () => {
    const requiredFields: (keyof OAuthProviderConfig)[] = [
      'authorizeHost',
      'authorizePath',
      'tokenHost',
      'tokenPath',
    ]

    it('should have all required fields for every provider', () => {
      for (const [name, config] of Object.entries(OAUTH_PROVIDERS)) {
        for (const field of requiredFields) {
          expect(config[field], `${name}.${field} should be defined`).toBeDefined()
          expect(typeof config[field], `${name}.${field} should be a string`).toBe('string')
          expect((config[field] as string).length, `${name}.${field} should not be empty`).toBeGreaterThan(0)
        }
      }
    })

    it('should have valid HTTPS URLs for hosts', () => {
      for (const [name, config] of Object.entries(OAUTH_PROVIDERS)) {
        expect(config.authorizeHost, `${name}.authorizeHost`).toMatch(/^https:\/\//)
        expect(config.tokenHost, `${name}.tokenHost`).toMatch(/^https:\/\//)
      }
    })

    it('should have paths starting with /', () => {
      for (const [name, config] of Object.entries(OAUTH_PROVIDERS)) {
        expect(config.authorizePath, `${name}.authorizePath`).toMatch(/^\//)
        expect(config.tokenPath, `${name}.tokenPath`).toMatch(/^\//)
        if (config.revokePath) {
          expect(config.revokePath, `${name}.revokePath`).toMatch(/^\//)
        }
      }
    })

    it('should include github provider', () => {
      expect(OAUTH_PROVIDERS.github).toBeDefined()
      expect(OAUTH_PROVIDERS.github.authorizeHost).toBe('https://github.com')
      expect(OAUTH_PROVIDERS.github.tokenPath).toBe('/login/oauth/access_token')
    })

    it('should include google provider', () => {
      expect(OAUTH_PROVIDERS.google).toBeDefined()
      expect(OAUTH_PROVIDERS.google.authorizeHost).toBe('https://accounts.google.com')
      expect(OAUTH_PROVIDERS.google.revokePath).toBe('/revoke')
    })

    it('should include atlassian provider', () => {
      expect(OAUTH_PROVIDERS.atlassian).toBeDefined()
      expect(OAUTH_PROVIDERS.atlassian.authorizeHost).toBe('https://auth.atlassian.com')
    })

    it('should include microsoft provider', () => {
      expect(OAUTH_PROVIDERS.microsoft).toBeDefined()
      expect(OAUTH_PROVIDERS.microsoft.authorizeHost).toBe('https://login.microsoftonline.com')
    })

    it('should include gitlab provider with revokePath', () => {
      expect(OAUTH_PROVIDERS.gitlab).toBeDefined()
      expect(OAUTH_PROVIDERS.gitlab.revokePath).toBe('/oauth/revoke')
    })

    it('should include slack provider', () => {
      expect(OAUTH_PROVIDERS.slack).toBeDefined()
      expect(OAUTH_PROVIDERS.slack.tokenPath).toBe('/api/oauth.v2.access')
    })
  })

  // ─── getProviderConfig ────────────────────────────────────────

  describe('getProviderConfig', () => {
    it('should return config for a known provider', () => {
      const config = getProviderConfig('github')
      expect(config).toBeDefined()
      expect(config?.authorizeHost).toBe('https://github.com')
    })

    it('should be case-insensitive', () => {
      const lower = getProviderConfig('github')
      const upper = getProviderConfig('GitHub')
      const mixed = getProviderConfig('GITHUB')

      expect(lower).toEqual(upper)
      expect(lower).toEqual(mixed)
    })

    it('should return undefined for an unknown provider', () => {
      const config = getProviderConfig('unknown-provider')
      expect(config).toBeUndefined()
    })

    it('should return undefined for empty string', () => {
      const config = getProviderConfig('')
      expect(config).toBeUndefined()
    })
  })

  // ─── listProviders ────────────────────────────────────────────

  describe('listProviders', () => {
    it('should return all known provider names', () => {
      const providers = listProviders()

      expect(providers).toContain('github')
      expect(providers).toContain('google')
      expect(providers).toContain('atlassian')
      expect(providers).toContain('microsoft')
      expect(providers).toContain('gitlab')
      expect(providers).toContain('slack')
    })

    it('should return the same count as OAUTH_PROVIDERS keys', () => {
      const providers = listProviders()
      expect(providers.length).toBe(Object.keys(OAUTH_PROVIDERS).length)
    })

    it('should return an array of strings', () => {
      const providers = listProviders()
      for (const name of providers) {
        expect(typeof name).toBe('string')
      }
    })
  })
})
