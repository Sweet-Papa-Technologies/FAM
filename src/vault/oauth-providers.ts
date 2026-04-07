/**
 * vault/oauth-providers.ts — OAuth2 provider endpoint registry.
 *
 * Known provider configurations for common OAuth2 services.
 * Each provider entry contains the authorize and token endpoint
 * URLs needed by the simple-oauth2 AuthorizationCode flow.
 */

// ─── Provider Config Type ─────────────────────────────────────────

export interface OAuthProviderConfig {
  authorizeHost: string
  authorizePath: string
  tokenHost: string
  tokenPath: string
  revokePath?: string
}

// ─── Known Provider Registry ──────────────────────────────────────

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    authorizeHost: 'https://github.com',
    authorizePath: '/login/oauth/authorize',
    tokenHost: 'https://github.com',
    tokenPath: '/login/oauth/access_token',
  },
  google: {
    authorizeHost: 'https://accounts.google.com',
    authorizePath: '/o/oauth2/v2/auth',
    tokenHost: 'https://oauth2.googleapis.com',
    tokenPath: '/token',
    revokePath: '/revoke',
  },
  atlassian: {
    authorizeHost: 'https://auth.atlassian.com',
    authorizePath: '/authorize',
    tokenHost: 'https://auth.atlassian.com',
    tokenPath: '/oauth/token',
  },
  microsoft: {
    authorizeHost: 'https://login.microsoftonline.com',
    authorizePath: '/common/oauth2/v2.0/authorize',
    tokenHost: 'https://login.microsoftonline.com',
    tokenPath: '/common/oauth2/v2.0/token',
  },
  gitlab: {
    authorizeHost: 'https://gitlab.com',
    authorizePath: '/oauth/authorize',
    tokenHost: 'https://gitlab.com',
    tokenPath: '/oauth/token',
    revokePath: '/oauth/revoke',
  },
  slack: {
    authorizeHost: 'https://slack.com',
    authorizePath: '/oauth/v2/authorize',
    tokenHost: 'https://slack.com',
    tokenPath: '/api/oauth.v2.access',
  },
}

// ─── Lookup Helpers ───────────────────────────────────────────────

/**
 * Look up a provider's OAuth2 endpoint configuration by name.
 * Returns undefined if the provider is not in the registry.
 */
export function getProviderConfig(provider: string): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS[provider.toLowerCase()]
}

/**
 * List all registered provider names.
 */
export function listProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS)
}
