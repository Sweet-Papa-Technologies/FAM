/**
 * test/unit/drift/detector.test.ts — Drift detection tests.
 *
 * Tests the drift detector against temp directories with
 * synthetic state files and config files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { detectDrift, formatDriftReport } from '../../../src/drift/index.js'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('Drift Detector', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `fam-drift-test-${randomBytes(6).toString('hex')}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  /**
   * Helper to write a state.json with generated_configs.
   */
  function writeState(
    configs: Record<string, { path: string; content_hash: string; strategy?: string; last_written?: string }>,
  ) {
    const state = {
      version: '0.1',
      last_applied: '2026-04-06T12:00:00Z',
      applied_config_hash: 'abc123',
      credentials: {},
      mcp_servers: {},
      profiles: {},
      generated_configs: Object.fromEntries(
        Object.entries(configs).map(([name, cfg]) => [
          name,
          {
            path: cfg.path,
            content_hash: cfg.content_hash,
            strategy: cfg.strategy ?? 'overwrite',
            last_written: cfg.last_written ?? '2026-04-06T12:00:00Z',
          },
        ]),
      ),
    }
    writeFileSync(join(tempDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8')
  }

  it('returns empty report when no state file exists', () => {
    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(0)
    expect(report.entries).toHaveLength(0)
    expect(report.hasDrift).toBe(false)
  })

  it('returns empty report when generated_configs is empty', () => {
    writeState({})
    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(0)
    expect(report.entries).toHaveLength(0)
    expect(report.hasDrift).toBe(false)
  })

  it('detects clean (unchanged) config files', () => {
    const content = '{"mcpServers":{"fam":{"url":"http://localhost:7865"}}}'
    const hash = sha256(content)
    const configPath = join(tempDir, 'config.json')
    writeFileSync(configPath, content, 'utf-8')

    writeState({
      cursor: { path: configPath, content_hash: hash },
    })

    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(1)
    expect(report.clean).toBe(1)
    expect(report.modified).toBe(0)
    expect(report.missing).toBe(0)
    expect(report.hasDrift).toBe(false)

    expect(report.entries[0].status).toBe('clean')
    expect(report.entries[0].currentHash).toBe(hash)
  })

  it('detects modified config files', () => {
    const originalContent = '{"mcpServers":{"fam":{"url":"http://localhost:7865"}}}'
    const originalHash = sha256(originalContent)
    const configPath = join(tempDir, 'config.json')

    // Write a different content to the file
    const modifiedContent = '{"mcpServers":{"fam":{"url":"http://localhost:9999"}}}'
    writeFileSync(configPath, modifiedContent, 'utf-8')

    writeState({
      cursor: { path: configPath, content_hash: originalHash },
    })

    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(1)
    expect(report.clean).toBe(0)
    expect(report.modified).toBe(1)
    expect(report.missing).toBe(0)
    expect(report.hasDrift).toBe(true)

    expect(report.entries[0].status).toBe('modified')
    expect(report.entries[0].currentHash).toBe(sha256(modifiedContent))
    expect(report.entries[0].expectedHash).toBe(originalHash)
  })

  it('detects missing config files', () => {
    const nonexistentPath = join(tempDir, 'does-not-exist.json')
    writeState({
      vscode: { path: nonexistentPath, content_hash: 'abc123def456' },
    })

    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(1)
    expect(report.clean).toBe(0)
    expect(report.modified).toBe(0)
    expect(report.missing).toBe(1)
    expect(report.hasDrift).toBe(true)

    expect(report.entries[0].status).toBe('missing')
    expect(report.entries[0].currentHash).toBeUndefined()
  })

  it('handles mixed states correctly', () => {
    // Clean file
    const cleanContent = 'clean content'
    const cleanHash = sha256(cleanContent)
    const cleanPath = join(tempDir, 'clean.json')
    writeFileSync(cleanPath, cleanContent, 'utf-8')

    // Modified file
    const modifiedPath = join(tempDir, 'modified.json')
    writeFileSync(modifiedPath, 'new content', 'utf-8')

    // Missing file
    const missingPath = join(tempDir, 'missing.json')

    writeState({
      'profile-a': { path: cleanPath, content_hash: cleanHash },
      'profile-b': { path: modifiedPath, content_hash: sha256('original content') },
      'profile-c': { path: missingPath, content_hash: 'deadbeef' },
    })

    const report = detectDrift(tempDir)
    expect(report.totalConfigs).toBe(3)
    expect(report.clean).toBe(1)
    expect(report.modified).toBe(1)
    expect(report.missing).toBe(1)
    expect(report.hasDrift).toBe(true)
  })

  it('preserves metadata from state in entries', () => {
    const content = 'test'
    const configPath = join(tempDir, 'test.json')
    writeFileSync(configPath, content, 'utf-8')

    writeState({
      myprofile: {
        path: configPath,
        content_hash: sha256(content),
        strategy: 'import_and_manage',
        last_written: '2026-04-05T10:30:00Z',
      },
    })

    const report = detectDrift(tempDir)
    const entry = report.entries[0]
    expect(entry.name).toBe('myprofile')
    expect(entry.path).toBe(configPath)
    expect(entry.strategy).toBe('import_and_manage')
    expect(entry.lastApplied).toBe('2026-04-05T10:30:00Z')
  })

  it('includes a valid ISO timestamp in the report', () => {
    writeState({})
    const report = detectDrift(tempDir)
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('formatDriftReport', () => {
  it('formats an empty report', () => {
    const report = {
      timestamp: '2026-04-06T14:00:00.000Z',
      totalConfigs: 0,
      clean: 0,
      modified: 0,
      missing: 0,
      entries: [],
      hasDrift: false,
    }
    const output = formatDriftReport(report)
    expect(output).toContain('No generated configs found')
  })

  it('formats a clean report', () => {
    const report = {
      timestamp: '2026-04-06T14:00:00.000Z',
      totalConfigs: 1,
      clean: 1,
      modified: 0,
      missing: 0,
      entries: [
        {
          name: 'cursor',
          path: '/home/user/.cursor/mcp.json',
          status: 'clean' as const,
          expectedHash: 'abcdef123456',
          currentHash: 'abcdef123456',
          strategy: 'overwrite',
          lastApplied: '2026-04-06T12:00:00Z',
        },
      ],
      hasDrift: false,
    }
    const output = formatDriftReport(report)
    expect(output).toContain('cursor')
    expect(output).toContain('clean')
    expect(output).toContain('1 configs:')
    expect(output).toContain('No drift detected')
  })

  it('formats a report with drift', () => {
    const report = {
      timestamp: '2026-04-06T14:00:00.000Z',
      totalConfigs: 2,
      clean: 0,
      modified: 1,
      missing: 1,
      entries: [
        {
          name: 'cursor',
          path: '/home/user/.cursor/mcp.json',
          status: 'modified' as const,
          expectedHash: 'aaaa11112222',
          currentHash: 'bbbb33334444',
          strategy: 'overwrite',
          lastApplied: '2026-04-06T12:00:00Z',
        },
        {
          name: 'vscode',
          path: '/home/user/.vscode/mcp.json',
          status: 'missing' as const,
          expectedHash: 'cccc55556666',
          strategy: 'import_and_manage',
          lastApplied: '2026-04-06T12:00:00Z',
        },
      ],
      hasDrift: true,
    }
    const output = formatDriftReport(report)
    expect(output).toContain('modified')
    expect(output).toContain('missing')
    expect(output).toContain('expected:')
    expect(output).toContain('current:')
    expect(output).toContain('Drift detected')
    expect(output).toContain('fam apply')
  })
})
