/**
 * generators/merge.ts — First-time merge strategy logic.
 *
 * Provides detection, backup, and application logic for the I/O/S
 * (Import / Overwrite / Skip) merge strategy described in DESIGN.md Section 8.2.
 *
 * The "import_and_manage" strategy performs a deep merge: FAM's generated
 * keys are injected into the existing config file, preserving all other
 * user settings. FAM keys win on conflict.
 *
 * NOTE: This module performs file I/O (unlike the pure generator functions).
 * The actual interactive prompt (I/O/S choice) lives in the CLI layer.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync } from 'node:fs'

// ─── Types ────────────────────────────────────────────────────────

export interface MergeDecision {
  strategy: 'import_and_manage' | 'overwrite' | 'skip'
  existingServers?: Array<{ name: string; config: unknown }>
  backupPath?: string
}

export interface DetectResult {
  exists: boolean
  servers?: Array<{ name: string; config: unknown }>
}

// ─── Detection ────────────────────────────────────────────────────

/**
 * Detect whether an existing config file exists at the target path
 * and extract any MCP server entries from it.
 *
 * Supports JSON config files with either `mcpServers` (Claude Code, Cursor)
 * or `servers` (VS Code) top-level keys.
 */
export function detectExistingConfig(targetPath: string): DetectResult {
  if (!existsSync(targetPath)) {
    return { exists: false }
  }

  try {
    const raw = readFileSync(targetPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== 'object' || parsed === null) {
      return { exists: true, servers: [] }
    }

    const obj = parsed as Record<string, unknown>
    const servers: Array<{ name: string; config: unknown }> = []

    // Try mcpServers (Claude Code, Cursor format)
    const mcpServers = obj['mcpServers']
    if (mcpServers && typeof mcpServers === 'object' && mcpServers !== null) {
      for (const [name, config] of Object.entries(mcpServers as Record<string, unknown>)) {
        servers.push({ name, config })
      }
    }

    // Try servers (VS Code format)
    const vscodeServers = obj['servers']
    if (vscodeServers && typeof vscodeServers === 'object' && vscodeServers !== null) {
      for (const [name, config] of Object.entries(vscodeServers as Record<string, unknown>)) {
        servers.push({ name, config })
      }
    }

    return { exists: true, servers }
  } catch {
    // File exists but is not valid JSON — treat as existing with no parseable servers
    return { exists: true, servers: [] }
  }
}

// ─── Backup ───────────────────────────────────────────────────────

/**
 * Create a backup of the target config file at `<path>.pre-fam`.
 * Returns the backup path.
 */
export function createBackup(targetPath: string): string {
  const backupPath = `${targetPath}.pre-fam`
  copyFileSync(targetPath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
}

// ─── Deep Merge ──────────────────────────────────────────────────

/**
 * Deep-merge two objects. Values from `overlay` win on conflict.
 * Arrays are replaced (not concatenated). Null/undefined in overlay
 * are treated as intentional overrides.
 */
function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }

  for (const [key, value] of Object.entries(overlay)) {
    const baseVal = result[key]

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      // Both are plain objects — recurse
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      // Primitive, array, or type mismatch — overlay wins
      result[key] = value
    }
  }

  return result
}

// ─── Apply Strategy ───────────────────────────────────────────────

/**
 * Apply a merge strategy to a target config file.
 *
 * - `import_and_manage`: Backup existing, then deep-merge FAM's
 *   generated keys into the existing config. All existing user
 *   settings are preserved; FAM keys win on conflict.
 *
 * - `overwrite`: Backup existing, replace entirely with FAM config.
 *
 * - `skip`: Do nothing.
 *
 * @param targetPath - Absolute path to the config file
 * @param famContent - The FAM-generated config content string (JSON)
 * @param strategy - The merge strategy to apply
 */
export function applyMergeStrategy(
  targetPath: string,
  famContent: string,
  strategy: 'import_and_manage' | 'overwrite' | 'skip'
): void {
  if (strategy === 'skip') {
    return
  }

  // Backup existing file
  if (existsSync(targetPath)) {
    createBackup(targetPath)
  }

  if (strategy === 'import_and_manage' && existsSync(targetPath)) {
    // Read existing config, deep-merge FAM keys into it
    try {
      const existingRaw = readFileSync(targetPath, 'utf-8')
      const existing = JSON.parse(existingRaw) as Record<string, unknown>
      const famObj = JSON.parse(famContent) as Record<string, unknown>

      const merged = deepMerge(existing, famObj)
      const mergedContent = JSON.stringify(merged, null, 2) + '\n'

      writeFileSync(targetPath, mergedContent, 'utf-8')
      chmodSync(targetPath, 0o600)
      return
    } catch {
      // If existing file isn't valid JSON, fall through to overwrite
    }
  }

  // Overwrite (or import_and_manage fallback if existing wasn't parseable)
  writeFileSync(targetPath, famContent, 'utf-8')
  chmodSync(targetPath, 0o600)
}
