/**
 * audit/export.ts — Export formatting helpers.
 *
 * Standalone pure functions for formatting audit data as JSON or CSV.
 * Used by AuditLogger.export() and available for direct use.
 */

import type { AuditEntry, AuditFilters, McpCallEntry, ConfigChangeEntry } from './types.js'

// ─── Narrowed types for the two sides of the AuditEntry union ────────

type McpCallAuditEntry = { id: number; timestamp: string } & McpCallEntry
type ConfigChangeAuditEntry = { id: number; timestamp: string } & ConfigChangeEntry

// ─── Type guards for distinguishing entry types ──────────────────────

function isMcpCallEntry(entry: AuditEntry): entry is McpCallAuditEntry {
  return 'profile' in entry && 'toolName' in entry
}

function isConfigChangeEntry(entry: AuditEntry): entry is ConfigChangeAuditEntry {
  return 'action' in entry && 'target' in entry && !('toolName' in entry)
}

// ─── JSON Export ──────────────────────────────────────────────────────

/**
 * Formats audit entries as a JSON export document.
 *
 * Output structure matches DESIGN.md Section 10.4:
 * {
 *   exported_at: ISO timestamp,
 *   period: { from, to },
 *   calls: [...],
 *   changes: [...]
 * }
 */
export function formatAsJson(
  calls: AuditEntry[],
  changes: AuditEntry[],
  filters: AuditFilters,
): string {
  const now = new Date().toISOString()

  // Determine period boundaries from the data
  const allTimestamps = [...calls, ...changes]
    .map((e) => e.timestamp)
    .filter(Boolean)
    .sort()

  const from = allTimestamps.length > 0 ? allTimestamps[0] : now
  const to = allTimestamps.length > 0 ? allTimestamps[allTimestamps.length - 1] : now

  const callObjects = calls.filter(isMcpCallEntry).map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    profile: entry.profile,
    server_ns: entry.serverNs,
    tool_name: entry.toolName,
    status: entry.status,
    latency_ms: entry.latencyMs ?? null,
    error_msg: entry.errorMsg ?? null,
  }))

  const changeObjects = changes.filter(isConfigChangeEntry).map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    target: entry.target,
    details: entry.details ?? null,
  }))

  const exportDoc = {
    exported_at: now,
    period: { from, to },
    filters: {
      ...(filters.profile && { profile: filters.profile }),
      ...(filters.serverNs && { server_ns: filters.serverNs }),
      ...(filters.since && { since: filters.since }),
      ...(filters.status && { status: filters.status }),
      ...(filters.limit && { limit: filters.limit }),
    },
    calls: callObjects,
    changes: changeObjects,
  }

  return JSON.stringify(exportDoc, null, 2)
}

// ─── CSV Export ──────────────────────────────────────────────────────

/**
 * Formats mcp_calls audit entries as CSV.
 * Includes header row. Uses snake_case column names to match DB schema.
 */
export function formatAsCsv(calls: AuditEntry[]): string {
  const headers = ['id', 'timestamp', 'profile', 'server_ns', 'tool_name', 'status', 'latency_ms', 'error_msg']
  const lines: string[] = [headers.join(',')]

  for (const entry of calls) {
    if (!isMcpCallEntry(entry)) continue

    const row = [
      String(entry.id),
      escapeCsvField(entry.timestamp),
      escapeCsvField(entry.profile),
      escapeCsvField(entry.serverNs),
      escapeCsvField(entry.toolName),
      escapeCsvField(entry.status),
      entry.latencyMs != null ? String(entry.latencyMs) : '',
      entry.errorMsg != null ? escapeCsvField(entry.errorMsg) : '',
    ]

    lines.push(row.join(','))
  }

  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Escapes a CSV field value. Wraps in double quotes if the value
 * contains commas, double quotes, or newlines.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
