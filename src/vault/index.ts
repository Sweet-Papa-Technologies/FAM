/**
 * vault/index.ts — Barrel exports for the credential vault module.
 */

export { KeychainVault } from './keychain.js'
export { OAuthManager } from './oauth.js'
export { injectCredential } from './inject.js'
export type { InjectConfig } from './inject.js'
export type {
  CredentialVault,
  CredentialStatus,
  InjectedRequest,
} from './types.js'
