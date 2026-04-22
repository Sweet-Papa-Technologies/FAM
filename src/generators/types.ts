/**
 * generators/types.ts — Config generator type definitions.
 *
 * Defines the input/output shapes for config file generators
 * and instruction file generators. Based on DESIGN.md Section 4.2
 * (generators module interface).
 */

import type { ProfileConfig, GlobalSettings, ResolvedModelSet } from '../config/types.js'

// ─── Generator Input/Output ────────────────────────────────────────

export interface GeneratorInput {
  profile: ProfileConfig & { name: string }
  settings: GlobalSettings
  sessionToken: string
  daemonUrl: string
  models?: ResolvedModelSet | null
}

export interface GeneratorOutput {
  path: string
  content: string
  format: string
  warnings?: string[]
  /**
   * Additional files this generator needs to write alongside the primary output.
   * Used when a target agent reads from multiple files (e.g. Claude Code reads
   * MCP config from ~/.claude.json but env vars from ~/.claude/settings.json).
   * Secondary files are always written with import_and_manage merge semantics.
   */
  additionalFiles?: Array<{ path: string; content: string; format: string }>
}

// ─── Instruction File Input ────────────────────────────────────────

export interface InstructionInput {
  profile: ProfileConfig & { name: string }
  servers: Record<string, { description: string; tools: string[] }>
  nativeTools: string[]
  extraContext?: string
  injectInto?: string
}
