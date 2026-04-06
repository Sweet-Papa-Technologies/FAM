/**
 * vault/types.ts — Credential vault interfaces.
 *
 * Defines the contract for credential storage (OS keychain),
 * credential status reporting, and credential injection into
 * upstream MCP requests.
 */

// ─── Credential Status ─────────────────────────────────────────────

export interface CredentialStatus {
  name: string
  type: string
  exists: boolean
  lastSet?: string
  rotateAfterDays?: number
  tokenExpires?: string
}

// ─── Credential Vault Interface ────────────────────────────────────

/**
 * CredentialVault — Abstraction over OS keychain operations.
 *
 * The production implementation wraps @napi-rs/keyring.
 * Tests use an in-memory mock.
 */
export interface CredentialVault {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  exists(name: string): Promise<boolean>
  list(declaredNames: string[]): Promise<CredentialStatus[]>
}

// ─── Injected Request ──────────────────────────────────────────────

/**
 * InjectedRequest — The result of credential injection.
 *
 * Contains headers and/or environment variables that should be
 * applied to the upstream MCP request or stdio process.
 */
export interface InjectedRequest {
  headers?: Record<string, string>
  env?: Record<string, string>
}
