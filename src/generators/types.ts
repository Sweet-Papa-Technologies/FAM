/**
 * generators/types.ts — Config generator type definitions.
 *
 * Defines the input/output shapes for config file generators
 * and instruction file generators. Based on DESIGN.md Section 4.2
 * (generators module interface).
 */

import type { ProfileConfig, GlobalSettings } from '../config/types.js'

// ─── Generator Input/Output ────────────────────────────────────────

export interface GeneratorInput {
  profile: ProfileConfig & { name: string }
  settings: GlobalSettings
  sessionToken: string
  daemonUrl: string
}

export interface GeneratorOutput {
  path: string
  content: string
  format: string
}

// ─── Instruction File Input ────────────────────────────────────────

export interface InstructionInput {
  profile: ProfileConfig & { name: string }
  servers: Record<string, { description: string; tools: string[] }>
  nativeTools: string[]
  extraContext?: string
  injectInto?: string
}
