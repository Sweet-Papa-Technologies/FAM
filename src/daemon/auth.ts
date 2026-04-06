/**
 * daemon/auth.ts — Bearer token to profile resolution.
 *
 * Extracts Bearer tokens from HTTP Authorization headers (or query
 * params), hashes them with SHA-256, and resolves the associated
 * profile name from the session store. Based on DESIGN.md Section 10.2
 * and Section 13.2.
 */

import { hashToken } from '../utils/crypto.js'
import type { SessionStore } from '../config/types.js'

export interface SessionEntry {
  profile: string
  created: string
  lastUsed?: string
}

export class AuthEngine {
  private sessions: Map<string, SessionEntry>

  constructor(sessionsData: SessionStore) {
    this.sessions = new Map<string, SessionEntry>()
    for (const [hash, data] of Object.entries(sessionsData.tokens)) {
      this.sessions.set(hash, {
        profile: data.profile,
        created: data.created,
        lastUsed: data.last_used,
      })
    }
  }

  /**
   * Resolve a profile from an HTTP Authorization header.
   *
   * Expects the format: "Bearer fam_sk_..."
   * Hashes the token with SHA-256 and looks up the session store.
   *
   * @param authHeader - The raw Authorization header value
   * @returns The profile name, or null if invalid/missing
   */
  resolveProfile(authHeader: string | undefined): string | null {
    if (!authHeader) return null

    const match = authHeader.match(/^Bearer\s+(\S+)$/i)
    if (!match) return null

    const token = match[1]
    const hash = hashToken(token)
    const session = this.sessions.get(hash)
    if (!session) return null

    this.updateLastUsed(hash)
    return session.profile
  }

  /**
   * Resolve a profile from a query parameter token.
   *
   * Fallback for clients that cannot set Authorization headers.
   * Expects the raw token value (e.g., "fam_sk_cld_abc123...").
   *
   * @param token - The raw token from the query string
   * @returns The profile name, or null if invalid/missing
   */
  resolveProfileFromQuery(token: string | undefined): string | null {
    if (!token) return null

    const hash = hashToken(token)
    const session = this.sessions.get(hash)
    if (!session) return null

    this.updateLastUsed(hash)
    return session.profile
  }

  /**
   * Update the last_used timestamp for a session entry.
   *
   * @param tokenHash - The SHA-256 hash of the token
   */
  updateLastUsed(tokenHash: string): void {
    const session = this.sessions.get(tokenHash)
    if (session) {
      session.lastUsed = new Date().toISOString()
    }
  }

  /**
   * Get the count of active sessions.
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Get all registered profile names.
   */
  getProfiles(): string[] {
    const profiles = new Set<string>()
    for (const session of this.sessions.values()) {
      profiles.add(session.profile)
    }
    return [...profiles]
  }
}
