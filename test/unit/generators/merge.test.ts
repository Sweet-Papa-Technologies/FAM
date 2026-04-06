import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

import {
  detectExistingConfig,
  createBackup,
  applyMergeStrategy,
} from '../../../src/generators/merge.js'

// ─── Test Fixtures ────────────────────────────────────────────────

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `fam-merge-test-${randomBytes(6).toString('hex')}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── detectExistingConfig ─────────────────────────────────────────

describe('detectExistingConfig', () => {
  it('should return { exists: false } when file does not exist', () => {
    const result = detectExistingConfig(join(testDir, 'nonexistent.json'))
    expect(result.exists).toBe(false)
    expect(result.servers).toBeUndefined()
  })

  it('should parse mcpServers from existing Claude Code config', () => {
    const configPath = join(testDir, 'settings.json')
    const existingConfig = {
      mcpServers: {
        github: { url: 'http://localhost:3000', transport: 'sse' },
        slack: { url: 'http://localhost:3001', transport: 'sse' },
      },
    }
    writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = detectExistingConfig(configPath)
    expect(result.exists).toBe(true)
    expect(result.servers).toHaveLength(2)
    expect(result.servers![0].name).toBe('github')
    expect(result.servers![1].name).toBe('slack')
  })

  it('should parse servers from existing VS Code config', () => {
    const configPath = join(testDir, 'mcp.json')
    const existingConfig = {
      servers: {
        github: { type: 'sse', url: 'http://localhost:3000' },
      },
    }
    writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = detectExistingConfig(configPath)
    expect(result.exists).toBe(true)
    expect(result.servers).toHaveLength(1)
    expect(result.servers![0].name).toBe('github')
  })

  it('should return empty servers array for unparseable JSON', () => {
    const configPath = join(testDir, 'broken.json')
    writeFileSync(configPath, 'not valid json {{{')

    const result = detectExistingConfig(configPath)
    expect(result.exists).toBe(true)
    expect(result.servers).toEqual([])
  })

  it('should return empty servers array for JSON with no server keys', () => {
    const configPath = join(testDir, 'empty.json')
    writeFileSync(configPath, JSON.stringify({ version: '1.0' }))

    const result = detectExistingConfig(configPath)
    expect(result.exists).toBe(true)
    expect(result.servers).toEqual([])
  })
})

// ─── createBackup ─────────────────────────────────────────────────

describe('createBackup', () => {
  it('should create a .pre-fam backup file', () => {
    const configPath = join(testDir, 'settings.json')
    const content = JSON.stringify({ mcpServers: { old: {} } })
    writeFileSync(configPath, content)

    const backupPath = createBackup(configPath)
    expect(backupPath).toBe(`${configPath}.pre-fam`)
    expect(existsSync(backupPath)).toBe(true)
    expect(readFileSync(backupPath, 'utf-8')).toBe(content)
  })

  it('should preserve the original file', () => {
    const configPath = join(testDir, 'mcp.json')
    const content = '{"servers":{"github":{}}}'
    writeFileSync(configPath, content)

    createBackup(configPath)
    expect(readFileSync(configPath, 'utf-8')).toBe(content)
  })
})

// ─── applyMergeStrategy ──────────────────────────────────────────

describe('applyMergeStrategy', () => {
  const famContent = JSON.stringify({
    mcpServers: {
      fam: { url: 'http://localhost:7865/mcp', transport: 'sse' },
    },
  })

  it('should overwrite existing file and create backup with "overwrite" strategy', () => {
    const configPath = join(testDir, 'settings.json')
    const oldContent = JSON.stringify({ mcpServers: { github: {} } })
    writeFileSync(configPath, oldContent)

    applyMergeStrategy(configPath, famContent, 'overwrite')

    // Original should now contain FAM config
    expect(readFileSync(configPath, 'utf-8')).toBe(famContent)
    // Backup should exist with old content
    expect(readFileSync(`${configPath}.pre-fam`, 'utf-8')).toBe(oldContent)
  })

  it('should do nothing with "skip" strategy', () => {
    const configPath = join(testDir, 'settings.json')
    const oldContent = JSON.stringify({ mcpServers: { github: {} } })
    writeFileSync(configPath, oldContent)

    applyMergeStrategy(configPath, famContent, 'skip')

    // Original should be unchanged
    expect(readFileSync(configPath, 'utf-8')).toBe(oldContent)
    // No backup should exist
    expect(existsSync(`${configPath}.pre-fam`)).toBe(false)
  })

  it('should backup and write FAM config with "import_and_manage" strategy', () => {
    const configPath = join(testDir, 'settings.json')
    const oldContent = JSON.stringify({
      mcpServers: { github: {}, slack: {} },
    })
    writeFileSync(configPath, oldContent)

    applyMergeStrategy(configPath, famContent, 'import_and_manage')

    // Original should now contain FAM config
    expect(readFileSync(configPath, 'utf-8')).toBe(famContent)
    // Backup should exist with old content
    expect(readFileSync(`${configPath}.pre-fam`, 'utf-8')).toBe(oldContent)
  })

  it('should write FAM config to new path when no existing file', () => {
    const configPath = join(testDir, 'new-config.json')

    applyMergeStrategy(configPath, famContent, 'overwrite')

    expect(readFileSync(configPath, 'utf-8')).toBe(famContent)
    // No backup because file didn't exist before
    expect(existsSync(`${configPath}.pre-fam`)).toBe(false)
  })
})
