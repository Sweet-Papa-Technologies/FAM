/**
 * vault/oauth-providers.ts — OAuth2 provider endpoint registry.
 *
 * Known provider configurations for common OAuth2 services.
 * Each provider entry contains the authorize and token endpoint
 * URLs needed by the simple-oauth2 AuthorizationCode flow.
 *
 * For providers not in this list, use provider: "custom" in fam.yaml
 * with explicit authorize_url and token_url fields.
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
  // ── Source Control & Dev Platforms ────────────────────────────
  github: {
    authorizeHost: 'https://github.com',
    authorizePath: '/login/oauth/authorize',
    tokenHost: 'https://github.com',
    tokenPath: '/login/oauth/access_token',
  },
  gitlab: {
    authorizeHost: 'https://gitlab.com',
    authorizePath: '/oauth/authorize',
    tokenHost: 'https://gitlab.com',
    tokenPath: '/oauth/token',
    revokePath: '/oauth/revoke',
  },
  bitbucket: {
    authorizeHost: 'https://bitbucket.org',
    authorizePath: '/site/oauth2/authorize',
    tokenHost: 'https://bitbucket.org',
    tokenPath: '/site/oauth2/access_token',
  },

  // ── Productivity & Collaboration ─────────────────────────────
  google: {
    authorizeHost: 'https://accounts.google.com',
    authorizePath: '/o/oauth2/v2/auth',
    tokenHost: 'https://oauth2.googleapis.com',
    tokenPath: '/token',
    revokePath: '/revoke',
  },
  microsoft: {
    authorizeHost: 'https://login.microsoftonline.com',
    authorizePath: '/common/oauth2/v2.0/authorize',
    tokenHost: 'https://login.microsoftonline.com',
    tokenPath: '/common/oauth2/v2.0/token',
  },
  atlassian: {
    authorizeHost: 'https://auth.atlassian.com',
    authorizePath: '/authorize',
    tokenHost: 'https://auth.atlassian.com',
    tokenPath: '/oauth/token',
  },
  notion: {
    authorizeHost: 'https://api.notion.com',
    authorizePath: '/v1/oauth/authorize',
    tokenHost: 'https://api.notion.com',
    tokenPath: '/v1/oauth/token',
  },
  linear: {
    authorizeHost: 'https://linear.app',
    authorizePath: '/oauth/authorize',
    tokenHost: 'https://api.linear.app',
    tokenPath: '/oauth/token',
    revokePath: '/oauth/revoke',
  },

  // ── Messaging & Communication ────────────────────────────────
  slack: {
    authorizeHost: 'https://slack.com',
    authorizePath: '/oauth/v2/authorize',
    tokenHost: 'https://slack.com',
    tokenPath: '/api/oauth.v2.access',
  },
  discord: {
    authorizeHost: 'https://discord.com',
    authorizePath: '/oauth2/authorize',
    tokenHost: 'https://discord.com',
    tokenPath: '/api/oauth2/token',
    revokePath: '/api/oauth2/token/revoke',
  },

  // ── Design & Creative ────────────────────────────────────────
  figma: {
    authorizeHost: 'https://www.figma.com',
    authorizePath: '/oauth',
    tokenHost: 'https://api.figma.com',
    tokenPath: '/v1/oauth/token',
  },

  // ── Identity & SSO Providers ─────────────────────────────────
  okta: {
    // Users must replace {your-domain} with their Okta domain
    // or use provider: "custom" with explicit URLs
    authorizeHost: 'https://{your-domain}.okta.com',
    authorizePath: '/oauth2/default/v1/authorize',
    tokenHost: 'https://{your-domain}.okta.com',
    tokenPath: '/oauth2/default/v1/token',
    revokePath: '/oauth2/default/v1/revoke',
  },
  auth0: {
    // Users must replace {your-domain} with their Auth0 domain
    // or use provider: "custom" with explicit URLs
    authorizeHost: 'https://{your-domain}.auth0.com',
    authorizePath: '/authorize',
    tokenHost: 'https://{your-domain}.auth0.com',
    tokenPath: '/oauth/token',
    revokePath: '/oauth/revoke',
  },

  // ── Cloud Platforms ──────────────────────────────────────────
  aws_cognito: {
    // Users must replace {your-domain} with their Cognito domain
    // or use provider: "custom" with explicit URLs
    authorizeHost: 'https://{your-domain}.auth.{region}.amazoncognito.com',
    authorizePath: '/oauth2/authorize',
    tokenHost: 'https://{your-domain}.auth.{region}.amazoncognito.com',
    tokenPath: '/oauth2/token',
    revokePath: '/oauth2/revoke',
  },
}

// ─── Lookup Helpers ───────────────────────────────────────────────

/**
 * Look up a provider's OAuth2 endpoint configuration by name.
 * Returns undefined if the provider is not in the registry.
 *
 * For "custom" provider, returns undefined — caller should use
 * authorize_url and token_url from the credential config instead.
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
