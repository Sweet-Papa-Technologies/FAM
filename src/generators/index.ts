/**
 * generators/index.ts — Barrel exports for the generators module.
 *
 * Exports all generator functions, merge utilities, types, and
 * a registry map for looking up generators by name.
 */

// ─── Types ────────────────────────────────────────────────────────

export type {
  GeneratorInput,
  GeneratorOutput,
  InstructionInput,
} from './types.js'

export { buildFamMcpEntry } from './base.js'

// ─── Generators ───────────────────────────────────────────────────

export { generateClaudeCodeConfig } from './claude-code.js'
export { generateCursorConfig } from './cursor.js'
export { generateVSCodeConfig } from './vscode.js'
export { generateOpenHandsConfig } from './openhands.js'
export { generateGenericConfig } from './generic.js'
export { generateInstructionFile } from './instructions.js'

// ─── Merge Utilities ──────────────────────────────────────────────

export type { MergeDecision, DetectResult } from './merge.js'
export {
  detectExistingConfig,
  createBackup,
  applyMergeStrategy,
} from './merge.js'

// ─── Generator Registry ──────────────────────────────────────────

import { generateClaudeCodeConfig } from './claude-code.js'
import { generateCursorConfig } from './cursor.js'
import { generateVSCodeConfig } from './vscode.js'
import { generateOpenHandsConfig } from './openhands.js'
import { generateGenericConfig } from './generic.js'

import type { GeneratorInput, GeneratorOutput } from './types.js'

/**
 * Registry of generators keyed by config_target name.
 * Supports multiple aliases per generator for flexibility.
 */
export const generators: Record<string, (input: GeneratorInput) => GeneratorOutput> = {
  claude_code: generateClaudeCodeConfig,
  claude_mcp_config: generateClaudeCodeConfig,
  cursor: generateCursorConfig,
  cursor_mcp_config: generateCursorConfig,
  vscode: generateVSCodeConfig,
  vscode_mcp_config: generateVSCodeConfig,
  openhands: generateOpenHandsConfig,
  openhands_config: generateOpenHandsConfig,
  generic: generateGenericConfig,
  generic_mcp_list: generateGenericConfig,
}
