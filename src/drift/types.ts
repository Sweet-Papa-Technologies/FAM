/**
 * drift/types.ts — Drift detection type definitions.
 *
 * Defines the data structures used to represent the result of
 * comparing live config files against their expected state hashes.
 */

// ─── Drift Status ─────────────────────────────────────────────────

export type DriftStatus = 'clean' | 'modified' | 'missing' | 'new'

// ─── Drift Entry ──────────────────────────────────────────────────

export interface DriftEntry {
  /** Profile or config name (key in generated_configs) */
  name: string
  /** File path (may contain ~/) */
  path: string
  /** Current drift status */
  status: DriftStatus
  /** SHA-256 hash recorded in state.json */
  expectedHash: string
  /** SHA-256 hash of the current file on disk (undefined if missing) */
  currentHash?: string
  /** Merge strategy used when the file was generated */
  strategy: string
  /** ISO timestamp of when fam apply last wrote this file */
  lastApplied: string
}

// ─── Drift Report ─────────────────────────────────────────────────

export interface DriftReport {
  /** ISO timestamp of when the drift check was performed */
  timestamp: string
  /** Total number of tracked config files */
  totalConfigs: number
  /** Count of files matching their expected hash */
  clean: number
  /** Count of files with content changes */
  modified: number
  /** Count of files that no longer exist on disk */
  missing: number
  /** Per-file drift entries */
  entries: DriftEntry[]
  /** True when any file is modified or missing */
  hasDrift: boolean
}
