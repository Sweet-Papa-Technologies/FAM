/**
 * audit/types.ts — Audit logging interfaces.
 *
 * Defines the schema for MCP call entries, config change entries,
 * query filters, and the audit logger interface. Based on DESIGN.md
 * Sections 5.4 and 10.
 */

// ─── MCP Call Entry ────────────────────────────────────────────────

export interface McpCallEntry {
  profile: string
  serverNs: string
  toolName: string
  status: 'success' | 'error' | 'timeout' | 'denied'
  latencyMs?: number
  errorMsg?: string
}

// ─── Config Change Entry ───────────────────────────────────────────

export interface ConfigChangeEntry {
  action: string
  target: string
  details?: string
}

// ─── Audit Query Filters ───────────────────────────────────────────

export interface AuditFilters {
  profile?: string
  serverNs?: string
  since?: string
  limit?: number
  status?: string
}

// ─── Audit Entry (returned from queries) ───────────────────────────

export type AuditEntry = { id: number; timestamp: string } & (McpCallEntry | ConfigChangeEntry)

// ─── Audit Logger Interface ────────────────────────────────────────

/**
 * IAuditLogger — Contract for the audit logging system.
 *
 * The production implementation uses better-sqlite3.
 * Tests can use an in-memory SQLite database.
 */
export interface IAuditLogger {
  init(): Promise<void>
  logCall(entry: McpCallEntry): void
  logConfigChange(entry: ConfigChangeEntry): void
  query(filters: AuditFilters): AuditEntry[]
  export(format: 'json' | 'csv', filters: AuditFilters): string
  close(): void
}
