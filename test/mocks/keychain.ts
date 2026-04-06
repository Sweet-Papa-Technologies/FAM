/**
 * test/mocks/keychain.ts — In-memory CredentialVault for testing.
 *
 * Replaces the real OS keychain so tests run without keychain
 * access (works in CI, no system prompts).
 */

import type {
  CredentialVault,
  CredentialStatus,
} from '../../src/vault/types.js'

export class InMemoryVault implements CredentialVault {
  private store = new Map<string, string>()

  async get(name: string): Promise<string | null> {
    return this.store.get(name) ?? null
  }

  async set(name: string, value: string): Promise<void> {
    this.store.set(name, value)
  }

  async delete(name: string): Promise<void> {
    this.store.delete(name)
  }

  async exists(name: string): Promise<boolean> {
    return this.store.has(name)
  }

  async list(declaredNames: string[]): Promise<CredentialStatus[]> {
    return declaredNames.map((name) => ({
      name,
      type: 'api_key',
      exists: this.store.has(name),
    }))
  }

  /** Test helper — clear all stored credentials. */
  clear(): void {
    this.store.clear()
  }
}
