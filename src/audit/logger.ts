/**
 * audit/logger.ts — AuditLogger implementation.
 *
 * Uses better-sqlite3 for synchronous SQLite access.
 * Implements IAuditLogger from ./types.ts.
 * Based on DESIGN.md Sections 4.2, 5.4, and 10.
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import type {
  IAuditLogger,
  McpCallEntry,
  ConfigChangeEntry,
  AuditFilters,
  AuditEntry,
} from './types.js'
import { formatAsJson, formatAsCsv } from './export.js'

// ─── DDL (inlined from schema.sql for runtime use) ───────────────────

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS mcp_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  profile     TEXT NOT NULL,
  server_ns   TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  status      TEXT NOT NULL,
  latency_ms  INTEGER,
  error_msg   TEXT
);

CREATE TABLE IF NOT EXISTS config_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  details     TEXT
);

CREATE INDEX IF NOT EXISTS idx_calls_timestamp ON mcp_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_calls_profile   ON mcp_calls(profile);
CREATE INDEX IF NOT EXISTS idx_calls_server    ON mcp_calls(server_ns);
CREATE INDEX IF NOT EXISTS idx_changes_ts      ON config_changes(timestamp);
CREATE INDEX IF NOT EXISTS idx_changes_action  ON config_changes(action);
`

// ─── "since" filter parser ────────────────────────────────────────────

/**
 * Converts a human-readable duration string ("1h", "24h", "7d", "30d")
 * into a SQLite datetime modifier string (e.g., "-1 hours", "-7 days").
 */
function parseSinceToModifier(since: string): string {
  const match = /^(\d+)([hdm])$/.exec(since)
  if (!match) {
    throw new Error(`Invalid "since" format: "${since}". Expected pattern like "1h", "24h", "7d", "30d".`)
  }
  const value = match[1]
  const unit = match[2]
  switch (unit) {
    case 'h':
      return `-${value} hours`
    case 'd':
      return `-${value} days`
    case 'm':
      return `-${value} months`
    default:
      throw new Error(`Unsupported time unit: "${unit}"`)
  }
}

// ─── Row types from SQLite ────────────────────────────────────────────

interface McpCallRow {
  id: number
  timestamp: string
  profile: string
  server_ns: string
  tool_name: string
  status: string
  latency_ms: number | null
  error_msg: string | null
}

interface ConfigChangeRow {
  id: number
  timestamp: string
  action: string
  target: string
  details: string | null
}

// ─── AuditLogger Class ───────────────────────────────────────────────

export class AuditLogger implements IAuditLogger {
  private db: DatabaseType | null = null
  private insertCallStmt: Statement | null = null
  private insertChangeStmt: Statement | null = null

  constructor(private dbPath: string) {}

  async init(): Promise<void> {
    this.db = new Database(this.dbPath)

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL')

    // Execute DDL
    this.db.exec(SCHEMA_DDL)

    // Prepare reusable statements
    this.insertCallStmt = this.db.prepare(
      `INSERT INTO mcp_calls (profile, server_ns, tool_name, status, latency_ms, error_msg)
       VALUES (@profile, @serverNs, @toolName, @status, @latencyMs, @errorMsg)`,
    )

    this.insertChangeStmt = this.db.prepare(
      `INSERT INTO config_changes (action, target, details)
       VALUES (@action, @target, @details)`,
    )
  }

  logCall(entry: McpCallEntry): void {
    if (!this.insertCallStmt) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }
    this.insertCallStmt.run({
      profile: entry.profile,
      serverNs: entry.serverNs,
      toolName: entry.toolName,
      status: entry.status,
      latencyMs: entry.latencyMs ?? null,
      errorMsg: entry.errorMsg ?? null,
    })
  }

  logConfigChange(entry: ConfigChangeEntry): void {
    if (!this.insertChangeStmt) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }
    this.insertChangeStmt.run({
      action: entry.action,
      target: entry.target,
      details: entry.details ?? null,
    })
  }

  query(filters: AuditFilters): AuditEntry[] {
    if (!this.db) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }

    const conditions: string[] = []
    const params: Record<string, string | number> = {}

    if (filters.profile) {
      conditions.push('profile = @profile')
      params.profile = filters.profile
    }

    if (filters.serverNs) {
      conditions.push('server_ns = @serverNs')
      params.serverNs = filters.serverNs
    }

    if (filters.status) {
      conditions.push('status = @status')
      params.status = filters.status
    }

    if (filters.since) {
      const modifier = parseSinceToModifier(filters.since)
      conditions.push(`timestamp >= datetime('now', @sinceModifier)`)
      params.sinceModifier = modifier
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ?? 50

    const sql = `SELECT id, timestamp, profile, server_ns, tool_name, status, latency_ms, error_msg
                 FROM mcp_calls ${whereClause}
                 ORDER BY timestamp DESC
                 LIMIT @limit`

    const rows = this.db.prepare(sql).all({ ...params, limit }) as McpCallRow[]

    return rows.map((row): AuditEntry => {
      const base = {
        id: row.id,
        timestamp: row.timestamp,
        profile: row.profile,
        serverNs: row.server_ns,
        toolName: row.tool_name,
        status: row.status as McpCallEntry['status'],
      }
      if (row.latency_ms != null) {
        Object.assign(base, { latencyMs: row.latency_ms })
      }
      if (row.error_msg != null) {
        Object.assign(base, { errorMsg: row.error_msg })
      }
      return base as AuditEntry
    })
  }

  /**
   * Query config_changes table with optional filters.
   */
  queryChanges(filters: AuditFilters): AuditEntry[] {
    if (!this.db) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }

    const conditions: string[] = []
    const params: Record<string, string | number> = {}

    if (filters.since) {
      const modifier = parseSinceToModifier(filters.since)
      conditions.push(`timestamp >= datetime('now', @sinceModifier)`)
      params.sinceModifier = modifier
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ?? 50

    const sql = `SELECT id, timestamp, action, target, details
                 FROM config_changes ${whereClause}
                 ORDER BY timestamp DESC
                 LIMIT @limit`

    const rows = this.db.prepare(sql).all({ ...params, limit }) as ConfigChangeRow[]

    return rows.map((row): AuditEntry => {
      const base = {
        id: row.id,
        timestamp: row.timestamp,
        action: row.action,
        target: row.target,
      }
      if (row.details != null) {
        Object.assign(base, { details: row.details })
      }
      return base as AuditEntry
    })
  }

  export(format: 'json' | 'csv', filters: AuditFilters): string {
    if (!this.db) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }

    // Query both tables for export
    const calls = this.query(filters)
    const changes = this.queryChanges(filters)

    if (format === 'json') {
      return formatAsJson(calls, changes, filters)
    }

    // CSV: export mcp_calls only (as specified in design)
    return formatAsCsv(calls)
  }

  runRetention(days: number): number {
    if (!this.db) {
      throw new Error('AuditLogger not initialized. Call init() first.')
    }

    const modifier = `-${days} days`

    const callsResult = this.db
      .prepare(`DELETE FROM mcp_calls WHERE timestamp < datetime('now', @modifier)`)
      .run({ modifier })

    const changesResult = this.db
      .prepare(`DELETE FROM config_changes WHERE timestamp < datetime('now', @modifier)`)
      .run({ modifier })

    return callsResult.changes + changesResult.changes
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.insertCallStmt = null
      this.insertChangeStmt = null
    }
  }
}
