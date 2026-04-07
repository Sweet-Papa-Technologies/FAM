/**
 * drift/detector.ts — Compare live config files against stored hashes.
 *
 * Reads the state file to find all generated configs, then hashes
 * the current file contents and compares against the stored hash.
 * This enables detection of unauthorized or accidental edits to
 * files that FAM manages.
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

import { loadState } from '../config/state.js'
import { expandTilde } from '../utils/paths.js'
import type { DriftEntry, DriftReport } from './types.js'

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Hash file contents with SHA-256.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// ─── Core Detection ───────────────────────────────────────────────

/**
 * Detect drift across all generated config files.
 *
 * Iterates over every entry in `state.generated_configs`, resolves
 * the file path, reads its current contents, and compares the
 * SHA-256 hash against the value recorded at last `fam apply`.
 *
 * @param famDir - The FAM data directory (where state.json lives)
 * @returns DriftReport with per-file status
 */
export function detectDrift(famDir: string): DriftReport {
  const state = loadState(famDir)

  const generatedConfigs = state.generated_configs
  if (!generatedConfigs || Object.keys(generatedConfigs).length === 0) {
    return {
      timestamp: new Date().toISOString(),
      totalConfigs: 0,
      clean: 0,
      modified: 0,
      missing: 0,
      entries: [],
      hasDrift: false,
    }
  }

  const entries: DriftEntry[] = []
  let clean = 0
  let modified = 0
  let missing = 0

  for (const [name, config] of Object.entries(generatedConfigs)) {
    const resolvedPath = expandTilde(config.path)

    if (!existsSync(resolvedPath)) {
      entries.push({
        name,
        path: config.path,
        status: 'missing',
        expectedHash: config.content_hash,
        strategy: config.strategy,
        lastApplied: config.last_written,
      })
      missing++
      continue
    }

    const currentContent = readFileSync(resolvedPath, 'utf-8')
    const currentHash = hashContent(currentContent)

    if (currentHash === config.content_hash) {
      entries.push({
        name,
        path: config.path,
        status: 'clean',
        expectedHash: config.content_hash,
        currentHash,
        strategy: config.strategy,
        lastApplied: config.last_written,
      })
      clean++
    } else {
      entries.push({
        name,
        path: config.path,
        status: 'modified',
        expectedHash: config.content_hash,
        currentHash,
        strategy: config.strategy,
        lastApplied: config.last_written,
      })
      modified++
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalConfigs: entries.length,
    clean,
    modified,
    missing,
    entries,
    hasDrift: modified > 0 || missing > 0,
  }
}

// ─── Formatting ───────────────────────────────────────────────────

/**
 * Format a drift report for CLI display.
 *
 * Returns a human-readable string without color codes (the CLI
 * layer adds chalk colors). Uses status icons:
 *   clean    -> checkmark
 *   modified -> warning
 *   missing  -> cross
 *
 * @param report - The drift report to format
 * @returns Multi-line formatted string
 */
export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = []

  lines.push(`Drift check at ${report.timestamp}`)
  lines.push('')

  if (report.totalConfigs === 0) {
    lines.push('No generated configs found. Run `fam apply` first.')
    return lines.join('\n')
  }

  const statusIcons: Record<string, string> = {
    clean: '\u2713',    // checkmark
    modified: '\u26A0', // warning
    missing: '\u2717',  // cross
  }

  for (const entry of report.entries) {
    const icon = statusIcons[entry.status] ?? '?'
    lines.push(`  ${icon} ${entry.name} -- ${entry.status}`)
    lines.push(`    ${entry.path}`)

    if (entry.status === 'modified') {
      lines.push(`    expected: ${entry.expectedHash.substring(0, 12)}...`)
      lines.push(`    current:  ${entry.currentHash?.substring(0, 12)}...`)
    }
  }

  lines.push('')

  // Summary line
  const parts: string[] = [`${report.totalConfigs} configs:`]
  if (report.clean > 0) {
    parts.push(`${report.clean} clean`)
  }
  if (report.modified > 0) {
    parts.push(`${report.modified} modified`)
  }
  if (report.missing > 0) {
    parts.push(`${report.missing} missing`)
  }
  lines.push(parts.join(', '))

  if (!report.hasDrift) {
    lines.push('')
    lines.push('No drift detected.')
  } else {
    lines.push('')
    lines.push('Drift detected. Run `fam apply` to reconcile.')
  }

  return lines.join('\n')
}
