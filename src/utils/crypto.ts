/**
 * utils/crypto.ts — Cryptographic utilities for FAM.
 *
 * Token generation and hashing for session token management.
 * Based on DESIGN.md Section 13.2.
 */

import { randomBytes, createHash } from 'node:crypto'

/**
 * Generate a session token for a profile.
 *
 * Format: `fam_sk_<3char>_<64hex>`
 * - `fam_sk_` prefix for easy identification (grep-able)
 * - 3-char profile abbreviation for context
 * - 64 hex chars (32 bytes = 256 bits of entropy)
 *
 * @param profileName - The profile this token is for
 * @returns A new session token string
 */
export function generateToken(profileName: string): string {
  const prefix = profileName.slice(0, 3).toLowerCase().padEnd(3, '_')
  const tokenBytes = randomBytes(32)
  return `fam_sk_${prefix}_${tokenBytes.toString('hex')}`
}

/**
 * Compute the SHA-256 hex digest of a token string.
 *
 * Used for storing token hashes in sessions.json.
 * The original token is shown once and never stored.
 *
 * @param token - The raw token string to hash
 * @returns SHA-256 hex digest
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
