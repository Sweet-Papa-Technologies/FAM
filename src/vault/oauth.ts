/**
 * vault/oauth.ts — OAuth2 flow manager.
 *
 * Implements the full OAuth2 authorization_code flow:
 * - Initiates browser-based authorization
 * - Exchanges authorization codes for tokens
 * - Manages token refresh and expiry
 * - Stores tokens in the credential vault
 *
 * Uses the simple-oauth2 library for the protocol layer and
 * a local HTTP callback server for the redirect.
 */

import { AuthorizationCode } from 'simple-oauth2'
import { randomBytes } from 'node:crypto'
import type { CredentialVault } from './types.js'
import type { FamConfig, OAuthCredConfig } from '../config/types.js'
import { getProviderConfig, listProviders } from './oauth-providers.js'
import type { OAuthProviderConfig } from './oauth-providers.js'
import { startCallbackServer } from './oauth-callback.js'
import { VaultError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

// ─── Token Status Type ────────────────────────────────────────────

export interface TokenStatus {
  hasAccessToken: boolean
  hasRefreshToken: boolean
  expiresAt?: string
  isExpired: boolean
}

// ─── OAuth Manager ────────────────────────────────────────────────

export class OAuthManager {
  constructor(
    private vault: CredentialVault,
    private config: FamConfig,
  ) {}

  // ─── Initiate OAuth Flow ──────────────────────────────────────

  /**
   * Start the OAuth2 authorization code flow for a credential.
   *
   * 1. Look up credential config (must be type: oauth2)
   * 2. Look up provider endpoints
   * 3. Retrieve client_secret from vault
   * 4. Generate CSRF state parameter
   * 5. Start local callback server + open browser
   * 6. Exchange authorization code for tokens
   * 7. Store tokens in vault
   */
  async initiateFlow(credName: string): Promise<void> {
    // 1. Get credential config
    const credConfig = this.getCredConfig(credName)

    // 2. Get provider endpoints (registry lookup or custom URLs)
    let providerConfig = getProviderConfig(credConfig.provider)

    if (!providerConfig && credConfig.provider === 'custom') {
      // Custom provider: user supplies URLs directly in fam.yaml
      if (!credConfig.authorize_url || !credConfig.token_url) {
        throw new VaultError(
          'OAUTH_MISSING_URLS',
          `Custom OAuth provider for '${credName}' requires both authorize_url and token_url in fam.yaml.`,
        )
      }
      const authorizeUrlObj = new URL(credConfig.authorize_url)
      const tokenUrlObj = new URL(credConfig.token_url)
      providerConfig = {
        authorizeHost: `${authorizeUrlObj.protocol}//${authorizeUrlObj.host}`,
        authorizePath: authorizeUrlObj.pathname,
        tokenHost: `${tokenUrlObj.protocol}//${tokenUrlObj.host}`,
        tokenPath: tokenUrlObj.pathname,
      }
    }

    if (!providerConfig) {
      const providers = listProviders()
      throw new VaultError(
        'OAUTH_UNKNOWN_PROVIDER',
        `Unknown OAuth provider '${credConfig.provider}' for credential '${credName}'. ` +
          `Supported providers: ${providers.join(', ')}. ` +
          `Or use provider: "custom" with authorize_url and token_url.`,
      )
    }

    // 3. Get client_secret from vault
    const clientSecret = await this.vault.get(`${credName}:client_secret`)
    if (!clientSecret) {
      throw new VaultError(
        'OAUTH_MISSING_CLIENT_SECRET',
        `Client secret not found for '${credName}'. ` +
          `Store it first: fam secret set ${credName}:client_secret`,
      )
    }

    // 4. Create OAuth2 client
    const oauth2Client = this.createOAuth2Client(
      credConfig,
      clientSecret,
      providerConfig,
    )

    // 5. Generate state parameter for CSRF protection
    const state = randomBytes(16).toString('hex')

    // 6. Generate authorize URL (with placeholder redirect_uri)
    const authorizeUrl = oauth2Client.authorizeURL({
      redirect_uri: 'http://127.0.0.1:0/callback',
      scope: credConfig.scopes,
      state,
    })

    logger.info(`Starting OAuth flow for '${credName}' (provider: ${credConfig.provider})`)

    // 7. Start callback server and open browser
    const callbackResult = await startCallbackServer(authorizeUrl)

    try {
      // Verify state parameter
      if (callbackResult.state !== state) {
        throw new VaultError(
          'OAUTH_STATE_MISMATCH',
          'OAuth state parameter mismatch — possible CSRF attack. Aborting.',
        )
      }

      // 8. Exchange code for tokens
      const redirectUri = `http://127.0.0.1:${callbackResult.port}/callback`
      const tokenResult = await oauth2Client.getToken({
        code: callbackResult.code,
        redirect_uri: redirectUri,
        scope: credConfig.scopes,
      })

      // 9. Store tokens in vault
      const token = tokenResult.token
      const accessToken = token.access_token as string
      if (!accessToken) {
        throw new VaultError(
          'OAUTH_NO_ACCESS_TOKEN',
          'Token exchange succeeded but no access_token was returned.',
        )
      }

      await this.vault.set(`${credName}:access`, accessToken)

      const refreshToken = token.refresh_token as string | undefined
      if (refreshToken) {
        await this.vault.set(`${credName}:refresh`, refreshToken)
      }

      // Store expiry time
      const expiresIn = token.expires_in as number | undefined
      if (expiresIn) {
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
        await this.vault.set(`${credName}:expires`, expiresAt)
      }

      // Store token type and scope if available
      const tokenType = token.token_type as string | undefined
      if (tokenType) {
        await this.vault.set(`${credName}:token_type`, tokenType)
      }

      const scope = token.scope as string | undefined
      if (scope) {
        await this.vault.set(`${credName}:scope`, scope)
      }

      logger.info(`OAuth flow completed for '${credName}' — tokens stored in vault`)
    } finally {
      callbackResult.close()
    }
  }

  // ─── Get Valid Token ──────────────────────────────────────────

  /**
   * Retrieve a valid access token for a credential.
   *
   * If the token is expired and a refresh token exists,
   * automatically refreshes and stores the new tokens.
   *
   * @returns The access token string
   * @throws VaultError if no token exists or refresh fails
   */
  async getValidToken(credName: string): Promise<string> {
    const credConfig = this.getCredConfig(credName)

    // Check if access token exists
    const accessToken = await this.vault.get(`${credName}:access`)
    if (!accessToken) {
      throw new VaultError(
        'OAUTH_NO_TOKEN',
        `No access token found for '${credName}'. Run: fam auth login ${credName}`,
      )
    }

    // Check expiry
    const expiresAt = await this.vault.get(`${credName}:expires`)
    if (expiresAt) {
      const expiryDate = new Date(expiresAt)
      const now = new Date()

      // Refresh if expired or expiring within 60 seconds
      if (expiryDate.getTime() - now.getTime() < 60_000) {
        logger.info(`Token for '${credName}' is expired or expiring soon, attempting refresh`)
        return this.refreshToken(credName, credConfig)
      }
    }

    return accessToken
  }

  // ─── Token Status ─────────────────────────────────────────────

  /**
   * Get the status of OAuth tokens for a credential.
   */
  async getTokenStatus(credName: string): Promise<TokenStatus> {
    const hasAccessToken = await this.vault.exists(`${credName}:access`)
    const hasRefreshToken = await this.vault.exists(`${credName}:refresh`)
    const expiresAt = await this.vault.get(`${credName}:expires`)

    let isExpired = false
    if (expiresAt) {
      isExpired = new Date(expiresAt).getTime() < Date.now()
    }

    return {
      hasAccessToken,
      hasRefreshToken,
      expiresAt: expiresAt ?? undefined,
      isExpired,
    }
  }

  // ─── Force Refresh ────────────────────────────────────────────

  /**
   * Force-refresh an OAuth2 access token using the stored refresh token.
   *
   * @returns The new access token
   */
  async forceRefresh(credName: string): Promise<string> {
    const credConfig = this.getCredConfig(credName)
    return this.refreshToken(credName, credConfig)
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /**
   * Look up and validate the credential config.
   */
  private getCredConfig(credName: string): OAuthCredConfig {
    const credConfig = this.config.credentials[credName]
    if (!credConfig) {
      throw new VaultError(
        'OAUTH_CREDENTIAL_NOT_FOUND',
        `Credential '${credName}' not found in fam.yaml`,
      )
    }

    if (credConfig.type !== 'oauth2') {
      throw new VaultError(
        'OAUTH_WRONG_TYPE',
        `Credential '${credName}' is type '${credConfig.type}', not 'oauth2'`,
      )
    }

    return credConfig
  }

  /**
   * Create a simple-oauth2 AuthorizationCode client.
   */
  private createOAuth2Client(
    credConfig: OAuthCredConfig,
    clientSecret: string,
    providerConfig: OAuthProviderConfig,
  ): AuthorizationCode {
    return new AuthorizationCode({
      client: {
        id: credConfig.client_id,
        secret: clientSecret,
      },
      auth: {
        tokenHost: providerConfig.tokenHost,
        tokenPath: providerConfig.tokenPath,
        authorizeHost: providerConfig.authorizeHost,
        authorizePath: providerConfig.authorizePath,
        revokePath: providerConfig.revokePath,
      },
    })
  }

  /**
   * Refresh an access token using the stored refresh token.
   */
  private async refreshToken(
    credName: string,
    credConfig: OAuthCredConfig,
  ): Promise<string> {
    const refreshToken = await this.vault.get(`${credName}:refresh`)
    if (!refreshToken) {
      throw new VaultError(
        'OAUTH_NO_REFRESH_TOKEN',
        `No refresh token for '${credName}'. Re-authorize: fam auth login ${credName}`,
      )
    }

    // Get client_secret
    const clientSecret = await this.vault.get(`${credName}:client_secret`)
    if (!clientSecret) {
      throw new VaultError(
        'OAUTH_MISSING_CLIENT_SECRET',
        `Client secret not found for '${credName}'. ` +
          `Store it first: fam secret set ${credName}:client_secret`,
      )
    }

    // Get provider config
    const providerConfig = getProviderConfig(credConfig.provider)
    if (!providerConfig) {
      throw new VaultError(
        'OAUTH_UNKNOWN_PROVIDER',
        `Unknown OAuth provider '${credConfig.provider}' for credential '${credName}'`,
      )
    }

    const oauth2Client = this.createOAuth2Client(credConfig, clientSecret, providerConfig)

    // Create an access token object from the stored refresh token
    const accessTokenObj = oauth2Client.createToken({
      access_token: '',
      refresh_token: refreshToken,
      token_type: 'Bearer',
    })

    try {
      const refreshedToken = await accessTokenObj.refresh()
      const token = refreshedToken.token

      const newAccessToken = token.access_token as string
      if (!newAccessToken) {
        throw new VaultError(
          'OAUTH_REFRESH_FAILED',
          `Token refresh for '${credName}' returned no access_token`,
        )
      }

      // Store the new tokens
      await this.vault.set(`${credName}:access`, newAccessToken)

      const newRefreshToken = token.refresh_token as string | undefined
      if (newRefreshToken) {
        await this.vault.set(`${credName}:refresh`, newRefreshToken)
      }

      const expiresIn = token.expires_in as number | undefined
      if (expiresIn) {
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
        await this.vault.set(`${credName}:expires`, expiresAt)
      }

      logger.info(`Token refreshed for '${credName}'`)
      return newAccessToken
    } catch (err) {
      if (err instanceof VaultError) throw err

      const msg = err instanceof Error ? err.message : String(err)
      throw new VaultError(
        'OAUTH_REFRESH_FAILED',
        `Failed to refresh token for '${credName}': ${msg}`,
      )
    }
  }
}
