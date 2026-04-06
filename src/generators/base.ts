/**
 * generators/base.ts — Shared helpers for config generators.
 *
 * Re-exports types and provides the common FAM MCP server entry builder
 * used by most generators (claude-code, cursor, vscode, etc.).
 */

export type { GeneratorInput, GeneratorOutput, InstructionInput } from './types.js'

import type { GeneratorInput } from './types.js'

/**
 * Build the standard FAM MCP server entry object.
 *
 * Returns the common shape used by most target tools:
 * ```json
 * {
 *   "url": "http://localhost:7865/mcp",
 *   "transport": "sse",
 *   "headers": { "Authorization": "Bearer <token>" }
 * }
 * ```
 */
export function buildFamMcpEntry(input: GeneratorInput): {
  url: string
  transport: string
  headers: Record<string, string>
} {
  const mcpUrl = input.daemonUrl.replace(/\/$/, '') + '/mcp'
  return {
    url: mcpUrl,
    transport: 'sse',
    headers: {
      Authorization: `Bearer ${input.sessionToken}`,
    },
  }
}
