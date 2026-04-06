/**
 * test/unit/vault/inject.test.ts — Credential injection unit tests.
 *
 * Tests the pure injectCredential function for all three injection
 * methods: header, env, and query.
 */

import { describe, it, expect } from 'vitest'
import { injectCredential } from '../../../src/vault/inject.js'

describe('injectCredential', () => {
  describe('header injection', () => {
    it('should inject with default Authorization: Bearer header', () => {
      const result = injectCredential('ghp_abc123', 'header')

      expect(result).toEqual({
        headers: {
          Authorization: 'Bearer ghp_abc123',
        },
      })
    })

    it('should inject with a custom header name', () => {
      const result = injectCredential('my-token', 'header', {
        headerName: 'X-API-Key',
      })

      expect(result).toEqual({
        headers: {
          'X-API-Key': 'Bearer my-token',
        },
      })
    })
  })

  describe('env injection', () => {
    it('should inject with default API_KEY env var', () => {
      const result = injectCredential('sk-xyz789', 'env')

      expect(result).toEqual({
        env: {
          API_KEY: 'sk-xyz789',
        },
      })
    })

    it('should inject with a custom env var name', () => {
      const result = injectCredential('sk-xyz789', 'env', {
        envVar: 'OPENAI_API_KEY',
      })

      expect(result).toEqual({
        env: {
          OPENAI_API_KEY: 'sk-xyz789',
        },
      })
    })
  })

  describe('query param injection', () => {
    it('should inject with default token query param', () => {
      const result = injectCredential('abc123', 'query')

      expect(result).toEqual({
        queryParams: {
          token: 'abc123',
        },
      })
    })

    it('should inject with a custom query param name', () => {
      const result = injectCredential('abc123', 'query', {
        queryParam: 'api_key',
      })

      expect(result).toEqual({
        queryParams: {
          api_key: 'abc123',
        },
      })
    })
  })
})
