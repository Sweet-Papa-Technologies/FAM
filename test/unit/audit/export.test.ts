/**
 * test/unit/audit/export.test.ts — Unit tests for export helpers.
 */

import { describe, it, expect } from 'vitest'
import { formatAsJson, formatAsCsv } from '../../../src/audit/export.js'
import type { AuditEntry } from '../../../src/audit/types.js'

// ─── Test data helpers ───────────────────────────────────────────────

function makeMcpCallEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    timestamp: '2026-04-06 12:00:00',
    profile: 'claude-code',
    serverNs: 'github',
    toolName: 'repos_list',
    status: 'success',
    latencyMs: 42,
    ...overrides,
  } as AuditEntry
}

function makeConfigChangeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    timestamp: '2026-04-06 12:00:00',
    action: 'apply',
    target: 'full-config',
    details: '{"changes":3}',
    ...overrides,
  } as AuditEntry
}

// ─── JSON Export ─────────────────────────────────────────────────────

describe('formatAsJson()', () => {
  it('should produce valid JSON with required structure', () => {
    const calls = [makeMcpCallEntry()]
    const changes = [makeConfigChangeEntry()]

    const json = formatAsJson(calls, changes, {})
    const parsed = JSON.parse(json)

    expect(parsed).toHaveProperty('exported_at')
    expect(parsed).toHaveProperty('period')
    expect(parsed.period).toHaveProperty('from')
    expect(parsed.period).toHaveProperty('to')
    expect(parsed).toHaveProperty('calls')
    expect(parsed).toHaveProperty('changes')
    expect(Array.isArray(parsed.calls)).toBe(true)
    expect(Array.isArray(parsed.changes)).toBe(true)
  })

  it('should map call entries to snake_case columns', () => {
    const entry: AuditEntry = {
      id: 5,
      timestamp: '2026-04-06 14:30:00',
      profile: 'cursor',
      serverNs: 'slack',
      toolName: 'send_message',
      status: 'error',
      errorMsg: 'timeout',
    } as AuditEntry

    const json = formatAsJson([entry], [], {})
    const parsed = JSON.parse(json)

    expect(parsed.calls).toHaveLength(1)
    expect(parsed.calls[0]).toEqual({
      id: 5,
      timestamp: '2026-04-06 14:30:00',
      profile: 'cursor',
      server_ns: 'slack',
      tool_name: 'send_message',
      status: 'error',
      latency_ms: null,
      error_msg: 'timeout',
    })
  })

  it('should map change entries to snake_case columns', () => {
    const changes = [
      makeConfigChangeEntry({
        id: 3,
        timestamp: '2026-04-06 15:00:00',
        action: 'secret_set',
        target: 'GITHUB_TOKEN',
        details: '{"credential":"github-pat"}',
      } as unknown as Partial<AuditEntry>),
    ]

    const json = formatAsJson([], changes, {})
    const parsed = JSON.parse(json)

    expect(parsed.changes).toHaveLength(1)
    expect(parsed.changes[0]).toEqual({
      id: 3,
      timestamp: '2026-04-06 15:00:00',
      action: 'secret_set',
      target: 'GITHUB_TOKEN',
      details: '{"credential":"github-pat"}',
    })
  })

  it('should include filters in output when provided', () => {
    const json = formatAsJson([], [], { profile: 'claude-code', since: '7d' })
    const parsed = JSON.parse(json)

    expect(parsed.filters).toEqual({
      profile: 'claude-code',
      since: '7d',
    })
  })

  it('should handle empty results', () => {
    const json = formatAsJson([], [], {})
    const parsed = JSON.parse(json)

    expect(parsed.calls).toEqual([])
    expect(parsed.changes).toEqual([])
    expect(parsed).toHaveProperty('exported_at')
    expect(parsed).toHaveProperty('period')
  })

  it('should compute period from data timestamps', () => {
    const calls = [
      makeMcpCallEntry({ timestamp: '2026-04-01 10:00:00' } as unknown as Partial<AuditEntry>),
      makeMcpCallEntry({ id: 2, timestamp: '2026-04-06 15:00:00' } as unknown as Partial<AuditEntry>),
    ]

    const json = formatAsJson(calls, [], {})
    const parsed = JSON.parse(json)

    expect(parsed.period.from).toBe('2026-04-01 10:00:00')
    expect(parsed.period.to).toBe('2026-04-06 15:00:00')
  })
})

// ─── CSV Export ──────────────────────────────────────────────────────

describe('formatAsCsv()', () => {
  it('should have correct header row', () => {
    const csv = formatAsCsv([])
    const lines = csv.split('\n')

    expect(lines[0]).toBe('id,timestamp,profile,server_ns,tool_name,status,latency_ms,error_msg')
  })

  it('should format call entries as CSV rows', () => {
    const calls = [
      makeMcpCallEntry({
        id: 1,
        timestamp: '2026-04-06 12:00:00',
        profile: 'claude-code',
        serverNs: 'github',
        toolName: 'repos_list',
        status: 'success',
        latencyMs: 42,
      } as unknown as Partial<AuditEntry>),
    ]

    const csv = formatAsCsv(calls)
    const lines = csv.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('1,2026-04-06 12:00:00,claude-code,github,repos_list,success,42,')
  })

  it('should handle missing optional fields', () => {
    const entry: AuditEntry = {
      id: 1,
      timestamp: '2026-04-06 12:00:00',
      profile: 'test',
      serverNs: 'test',
      toolName: 'test',
      status: 'success',
    } as AuditEntry

    const csv = formatAsCsv([entry])
    const lines = csv.split('\n')

    // latency_ms and error_msg should be empty
    expect(lines[1]).toContain('success,,')
  })

  it('should escape fields containing commas', () => {
    const calls = [
      makeMcpCallEntry({
        id: 1,
        timestamp: '2026-04-06 12:00:00',
        profile: 'test',
        serverNs: 'test',
        toolName: 'test',
        status: 'error',
        errorMsg: 'error, with comma',
      } as unknown as Partial<AuditEntry>),
    ]

    const csv = formatAsCsv(calls)
    const lines = csv.split('\n')

    expect(lines[1]).toContain('"error, with comma"')
  })

  it('should escape fields containing double quotes', () => {
    const calls = [
      makeMcpCallEntry({
        id: 1,
        timestamp: '2026-04-06 12:00:00',
        profile: 'test',
        serverNs: 'test',
        toolName: 'test',
        status: 'error',
        errorMsg: 'error "quoted"',
      } as unknown as Partial<AuditEntry>),
    ]

    const csv = formatAsCsv(calls)
    const lines = csv.split('\n')

    expect(lines[1]).toContain('"error ""quoted"""')
  })

  it('should handle empty results (header only)', () => {
    const csv = formatAsCsv([])
    const lines = csv.split('\n')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('id,timestamp,profile,server_ns,tool_name,status,latency_ms,error_msg')
  })

  it('should handle multiple rows', () => {
    const calls = [
      makeMcpCallEntry({ id: 1 } as unknown as Partial<AuditEntry>),
      makeMcpCallEntry({ id: 2, toolName: 'issues_list' } as unknown as Partial<AuditEntry>),
      makeMcpCallEntry({ id: 3, toolName: 'pr_merge' } as unknown as Partial<AuditEntry>),
    ]

    const csv = formatAsCsv(calls)
    const lines = csv.split('\n')

    expect(lines).toHaveLength(4) // header + 3 rows
  })
})
