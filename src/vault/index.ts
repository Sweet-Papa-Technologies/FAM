/**
 * vault/index.ts — Barrel exports for the credential vault module.
 */

export { KeychainVault } from './keychain.js'
export { OAuthManager } from './oauth.js'
export type { TokenStatus } from './oauth.js'
export { injectCredential } from './inject.js'
export type { InjectConfig } from './inject.js'
export { getProviderConfig, listProviders, OAUTH_PROVIDERS } from './oauth-providers.js'
export type { OAuthProviderConfig } from './oauth-providers.js'
export { startCallbackServer } from './oauth-callback.js'
export type { OAuthCallbackResult } from './oauth-callback.js'
export type {
  CredentialVault,
  CredentialStatus,
  InjectedRequest,
} from './types.js'
