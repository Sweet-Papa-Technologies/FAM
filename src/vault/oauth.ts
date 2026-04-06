/**
 * vault/oauth.ts — OAuth manager stub (v1 feature).
 *
 * OAuth2 authorization_code flow is deferred to v1.
 * This module provides placeholder methods that throw descriptive
 * errors guiding users to manually store tokens.
 */

import { VaultError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

export class OAuthManager {
  async getValidToken(credName: string): Promise<string> {
    throw new VaultError(
      'OAUTH_NOT_IMPLEMENTED',
      `OAuth flow not yet implemented. Store tokens manually: fam secret set ${credName}:access`,
    )
  }

  async initiateFlow(credName: string): Promise<void> {
    logger.warn(
      `OAuth flow for '${credName}' not yet implemented (v1 feature)`,
    )
    throw new VaultError(
      'OAUTH_NOT_IMPLEMENTED',
      'OAuth authorization flow is a v1 feature. Store tokens manually with fam secret set',
    )
  }
}
