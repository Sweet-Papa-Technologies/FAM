/**
 * config/state.ts -- State file management for FAM.
 *
 * Reads and writes `state.json` from the FAM data directory.
 * Uses atomic writes (write to .tmp file, then rename) to prevent
 * corruption from crashes or power loss.
 */

import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

import type { State } from './types.js'

/**
 * Create an empty State object with sensible defaults.
 * Used when no state file exists (first run).
 */
export function createEmptyState(): State {
  return {
    version: '0.1',
    last_applied: '',
    applied_config_hash: '',
    credentials: {},
    mcp_servers: {},
    profiles: {},
    generated_configs: {},
  }
}

/**
 * Load the state from `state.json` in the given FAM directory.
 *
 * If the file does not exist, returns an empty state.
 * If the file exists but is invalid JSON, throws.
 *
 * @param famDir - Absolute path to the FAM data directory (e.g., ~/.fam)
 * @returns The parsed State object
 */
export function loadState(famDir: string): State {
  const statePath = join(famDir, 'state.json')

  let raw: string
  try {
    raw = readFileSync(statePath, 'utf-8')
  } catch {
    // File doesn't exist or isn't readable -- return empty state
    return createEmptyState()
  }

  return JSON.parse(raw) as State
}

/**
 * Write state to `state.json` in the given FAM directory.
 *
 * Uses atomic write: writes to a `.tmp` file first, then renames
 * over the original. This prevents corruption if the process crashes
 * mid-write.
 *
 * @param famDir - Absolute path to the FAM data directory
 * @param state - The state to persist
 */
export function writeState(famDir: string, state: State): void {
  const statePath = join(famDir, 'state.json')
  const tmpPath = join(famDir, 'state.json.tmp')

  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, statePath)
  chmodSync(statePath, 0o600)
}
