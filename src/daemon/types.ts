/**
 * daemon/types.ts — Daemon and MCP proxy type definitions.
 *
 * Defines tool registry entries, MCP result shapes, call context,
 * daemon status, and daemon dependency injection. Based on DESIGN.md
 * Sections 4.2 and 5.5.
 */

import type { FamConfig } from '../config/types.js'
import type { CredentialVault } from '../vault/types.js'
import type { IAuditLogger } from '../audit/types.js'

// ─── Tool Registry Types (Section 5.5) ─────────────────────────────

export interface ToolEntry {
  namespacedName: string
  upstreamName: string
  namespace: string
  description: string
  inputSchema: object
  source: 'upstream' | 'native'
}

// ─── MCP Protocol Types ────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: object
}

export interface McpResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

// ─── Call Context ──────────────────────────────────────────────────

export interface CallContext {
  profile: string
}

// ─── Daemon Status ─────────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean
  pid?: number
  uptime?: number
  port?: number
  servers?: Record<string, { status: string; toolCount: number }>
  profiles?: string[]
}

// ─── Daemon Dependencies ───────────────────────────────────────────

/**
 * DaemonDeps — Dependency injection container for the daemon.
 *
 * Uses typed interfaces rather than `any`. The daemon receives
 * its dependencies at construction time to support testing.
 */
export interface DaemonDeps {
  config: FamConfig
  vault: CredentialVault
  audit: IAuditLogger
}
