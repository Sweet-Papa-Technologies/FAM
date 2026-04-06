/**
 * vault/keychain.ts — OS keychain credential vault.
 *
 * Wraps @napi-rs/keyring Entry class to implement the CredentialVault
 * interface. All credentials are stored under the service name "fam".
 *
 * Methods are async for interface consistency even though the underlying
 * keyring operations are synchronous.
 */

import { Entry } from '@napi-rs/keyring'
import type { CredentialVault, CredentialStatus } from './types.js'

export class KeychainVault implements CredentialVault {
  private service = 'fam'

  async get(name: string): Promise<string | null> {
    try {
      const entry = new Entry(this.service, name)
      return entry.getPassword()
    } catch {
      return null
    }
  }

  async set(name: string, value: string): Promise<void> {
    const entry = new Entry(this.service, name)
    entry.setPassword(value)
  }

  async delete(name: string): Promise<void> {
    const entry = new Entry(this.service, name)
    entry.deletePassword()
  }

  async exists(name: string): Promise<boolean> {
    const result = await this.get(name)
    return result !== null
  }

  async list(declaredNames: string[]): Promise<CredentialStatus[]> {
    const statuses: CredentialStatus[] = []
    for (const name of declaredNames) {
      const found = await this.exists(name)
      statuses.push({
        name,
        type: 'api_key',
        exists: found,
      })
    }
    return statuses
  }
}
