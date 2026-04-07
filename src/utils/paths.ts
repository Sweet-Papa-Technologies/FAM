/**
 * utils/paths.ts — Path resolution utilities for FAM.
 *
 * Provides consistent path resolution for the ~/.fam directory
 * and all files within it. Handles tilde expansion and ensures
 * the FAM directory exists when needed.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, existsSync, chmodSync } from 'node:fs'
import { ConfigError } from './errors.js'

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
 * Get the resolved absolute path to the FAM data directory.
 * Respects FAM_HOME env var for testing and custom installs,
 * otherwise defaults to ~/.fam.
 */
export function getFamDir(): string {
  if (process.env.FAM_HOME) {
    return resolve(process.env.FAM_HOME)
  }
  return resolve(expandTilde('~/.fam'))
}

/**
 * Ensure the FAM data directory (~/.fam) exists. Creates it if it doesn't.
 */
export function ensureFamDir(): void {
  const dir = getFamDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  chmodSync(dir, 0o700)
}

/**
 * Validate that an output path is safe — no traversal and not targeting system directories.
 */
export function validateOutputPath(path: string): void {
  const resolved = resolve(expandTilde(path))
  if (resolved.includes('..')) {
    throw new ConfigError('PATH_TRAVERSAL', `Output path contains '..': ${path}`)
  }
  // Block writing to sensitive system locations
  const blocked = ['/etc', '/usr', '/bin', '/sbin', '/root', '/System', '/Library']
  for (const prefix of blocked) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      throw new ConfigError('PATH_BLOCKED', `Output path targets a system directory: ${path}`)
    }
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

/** Knowledge store database */
export const KNOWLEDGE_DB = join(FAM_DIR, 'knowledge.db')

/** PID file: running daemon process ID */
export const PID_FILE = join(FAM_DIR, 'fam.pid')

/** Unix socket path for local daemon communication */
export const SOCKET_PATH = join(FAM_DIR, 'agent.sock')

/** Generated config files directory */
export const CONFIGS_DIR = join(FAM_DIR, 'configs')

/** Generated instruction files directory */
export const INSTRUCTIONS_DIR = join(FAM_DIR, 'instructions')
