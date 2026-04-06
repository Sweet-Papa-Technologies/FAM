/**
 * test/unit/vault/keychain.test.ts — CredentialVault unit tests.
 *
 * Uses the InMemoryVault mock so tests work in CI without real
 * OS keychain access. Validates the CredentialVault contract.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryVault } from '../../mocks/keychain.js'

describe('CredentialVault (InMemoryVault)', () => {
  let vault: InMemoryVault

  beforeEach(() => {
    vault = new InMemoryVault()
  })

  it('should round-trip set and get', async () => {
    await vault.set('github-pat', 'ghp_abc123')
    const result = await vault.get('github-pat')
    expect(result).toBe('ghp_abc123')
  })

  it('should return null for a non-existent credential', async () => {
    const result = await vault.get('does-not-exist')
    expect(result).toBeNull()
  })

  it('should report exists=true for a stored credential', async () => {
    await vault.set('my-key', 'value')
    const result = await vault.exists('my-key')
    expect(result).toBe(true)
  })

  it('should report exists=false for a missing credential', async () => {
    const result = await vault.exists('missing')
    expect(result).toBe(false)
  })

  it('should delete a credential', async () => {
    await vault.set('to-delete', 'temporary')
    expect(await vault.exists('to-delete')).toBe(true)

    await vault.delete('to-delete')
    expect(await vault.exists('to-delete')).toBe(false)
    expect(await vault.get('to-delete')).toBeNull()
  })

  it('should list credentials with correct exists status', async () => {
    await vault.set('github-pat', 'ghp_abc123')
    await vault.set('openai-key', 'sk-xyz789')

    const statuses = await vault.list([
      'github-pat',
      'openai-key',
      'missing-cred',
    ])

    expect(statuses).toHaveLength(3)

    expect(statuses[0]).toEqual({
      name: 'github-pat',
      type: 'api_key',
      exists: true,
    })

    expect(statuses[1]).toEqual({
      name: 'openai-key',
      type: 'api_key',
      exists: true,
    })

    expect(statuses[2]).toEqual({
      name: 'missing-cred',
      type: 'api_key',
      exists: false,
    })
  })

  it('should overwrite an existing credential', async () => {
    await vault.set('rotating', 'old-value')
    await vault.set('rotating', 'new-value')
    const result = await vault.get('rotating')
    expect(result).toBe('new-value')
  })

  it('should clear all credentials via test helper', async () => {
    await vault.set('a', '1')
    await vault.set('b', '2')
    vault.clear()
    expect(await vault.get('a')).toBeNull()
    expect(await vault.get('b')).toBeNull()
  })
})
