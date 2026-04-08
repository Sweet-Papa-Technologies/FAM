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
export { generateOpenCodeConfig } from './opencode.js'
export { generateGenericConfig } from './generic.js'
export { generateWindsurfConfig } from './windsurf.js'
export { generateZedConfig } from './zed.js'
export { generateClineConfig } from './cline.js'
export { generateRooCodeConfig } from './roo-code.js'
export { generateGeminiCliConfig } from './gemini-cli.js'
export { generateGithubCopilotConfig } from './github-copilot.js'
export { generateAmazonQConfig } from './amazon-q.js'
export { generateAiderConfig } from './aider.js'
export { generateContinueDevConfig } from './continue-dev.js'
export { generateOpenClawConfig, generateOpenClawModelsYaml } from './openclaw.js'
export { generateNemoClawConfig } from './nemoclaw.js'
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
import { generateOpenCodeConfig } from './opencode.js'
import { generateGenericConfig } from './generic.js'
import { generateWindsurfConfig } from './windsurf.js'
import { generateZedConfig } from './zed.js'
import { generateClineConfig } from './cline.js'
import { generateRooCodeConfig } from './roo-code.js'
import { generateGeminiCliConfig } from './gemini-cli.js'
import { generateGithubCopilotConfig } from './github-copilot.js'
import { generateAmazonQConfig } from './amazon-q.js'
import { generateAiderConfig } from './aider.js'
import { generateContinueDevConfig } from './continue-dev.js'
import { generateOpenClawConfig } from './openclaw.js'
import { generateNemoClawConfig } from './nemoclaw.js'

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
  opencode: generateOpenCodeConfig,
  opencode_config: generateOpenCodeConfig,
  generic: generateGenericConfig,
  generic_mcp_list: generateGenericConfig,
  windsurf: generateWindsurfConfig,
  windsurf_mcp_config: generateWindsurfConfig,
  zed: generateZedConfig,
  zed_config: generateZedConfig,
  cline: generateClineConfig,
  cline_mcp_config: generateClineConfig,
  roo_code: generateRooCodeConfig,
  roo_code_mcp_config: generateRooCodeConfig,
  gemini_cli: generateGeminiCliConfig,
  gemini_mcp_config: generateGeminiCliConfig,
  github_copilot: generateGithubCopilotConfig,
  github_copilot_mcp_config: generateGithubCopilotConfig,
  amazon_q: generateAmazonQConfig,
  amazon_q_config: generateAmazonQConfig,
  aider: generateAiderConfig,
  aider_config: generateAiderConfig,
  continue_dev: generateContinueDevConfig,
  continue_config: generateContinueDevConfig,
  openclaw: generateOpenClawConfig,
  openclaw_config: generateOpenClawConfig,
  nemoclaw: generateNemoClawConfig,
  nemoclaw_config: generateNemoClawConfig,
}
