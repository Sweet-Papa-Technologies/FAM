/**
 * utils/paths.ts — Path resolution utilities for FAM.
 *
 * Provides consistent path resolution for the ~/.fam directory
 * and all files within it. Handles tilde expansion and ensures
 * the FAM directory exists when needed.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

/**
 * Expand a leading `~` in a path to the user's home directory.
 */
export function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1))
  }
  return p
}

/**
 * Get the resolved absolute path to the FAM data directory (~/.fam).
 */
export function getFamDir(): string {
  return resolve(expandTilde('~/.fam'))
}

/**
 * Ensure the FAM data directory (~/.fam) exists. Creates it if it doesn't.
 */
export function ensureFamDir(): void {
  const dir = getFamDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ─── Path Constants ────────────────────────────────────────────────

/** Root FAM data directory */
export const FAM_DIR = getFamDir()

/** State file: last-applied configuration state */
export const STATE_FILE = join(FAM_DIR, 'state.json')

/** Session store: token hashes mapped to profiles */
export const SESSIONS_FILE = join(FAM_DIR, 'sessions.json')

/** Audit database: SQLite file for call and change logs */
export const AUDIT_DB = join(FAM_DIR, 'audit.db')

/** PID file: running daemon process ID */
export const PID_FILE = join(FAM_DIR, 'fam.pid')

/** Unix socket path for local daemon communication */
export const SOCKET_PATH = join(FAM_DIR, 'agent.sock')

/** Generated config files directory */
export const CONFIGS_DIR = join(FAM_DIR, 'configs')

/** Generated instruction files directory */
export const INSTRUCTIONS_DIR = join(FAM_DIR, 'instructions')
