/**
 * generators/merge.ts — First-time merge strategy logic.
 *
 * Provides detection, backup, and application logic for the I/O/S
 * (Import / Overwrite / Skip) merge strategy described in DESIGN.md Section 8.2.
 *
 * NOTE: This module performs file I/O (unlike the pure generator functions).
 * The actual interactive prompt (I/O/S choice) lives in the CLI layer.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

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
  return backupPath
}

// ─── Apply Strategy ───────────────────────────────────────────────

/**
 * Apply a merge strategy to a target config file.
 *
 * - `import_and_manage`: Backup existing, write FAM-only config.
 *   The caller is responsible for extracting existing servers and adding
 *   them to fam.yaml — this function only handles the file operations.
 *
 * - `overwrite`: Backup existing, write FAM-only config.
 *
 * - `skip`: Do nothing.
 *
 * @param targetPath - Absolute path to the config file
 * @param famContent - The FAM-only config content string to write
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

  // Both import_and_manage and overwrite: backup then write
  if (existsSync(targetPath)) {
    createBackup(targetPath)
  }

  writeFileSync(targetPath, famContent, 'utf-8')
}
