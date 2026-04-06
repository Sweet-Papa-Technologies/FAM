import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

import { loadState, writeState, createEmptyState } from '../../../src/config/state.js'
import type { State } from '../../../src/config/types.js'

describe('state management', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `fam-state-test-${randomBytes(4).toString('hex')}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('createEmptyState', () => {
    it('should return a valid empty state', () => {
      const state = createEmptyState()
      expect(state.version).toBe('0.1')
      expect(state.last_applied).toBe('')
      expect(state.applied_config_hash).toBe('')
      expect(state.credentials).toEqual({})
      expect(state.mcp_servers).toEqual({})
      expect(state.profiles).toEqual({})
      expect(state.generated_configs).toEqual({})
    })
  })

  describe('loadState', () => {
    it('should return empty state when file does not exist', () => {
      const state = loadState(tmpDir)
      expect(state.version).toBe('0.1')
      expect(state.credentials).toEqual({})
      expect(state.mcp_servers).toEqual({})
      expect(state.profiles).toEqual({})
      expect(state.generated_configs).toEqual({})
    })

    it('should load existing state from file', () => {
      const testState: State = {
        version: '0.1',
        last_applied: '2026-04-05T12:00:00Z',
        applied_config_hash: 'abc123',
        credentials: {
          'test-key': {
            type: 'api_key',
            exists_in_keychain: true,
            last_set: '2026-04-01T00:00:00Z',
          },
        },
        mcp_servers: {},
        profiles: {},
        generated_configs: {},
      }

      const statePath = join(tmpDir, 'state.json')
      writeFileSync(statePath, JSON.stringify(testState), 'utf-8')

      const loaded = loadState(tmpDir)
      expect(loaded.version).toBe('0.1')
      expect(loaded.last_applied).toBe('2026-04-05T12:00:00Z')
      expect(loaded.credentials['test-key']).toBeDefined()
      expect(loaded.credentials['test-key'].exists_in_keychain).toBe(true)
    })
  })

  describe('writeState', () => {
    it('should write state that can be read back', () => {
      const state: State = {
        version: '0.1',
        last_applied: '2026-04-06T10:00:00Z',
        applied_config_hash: 'def456',
        credentials: {
          'my-key': {
            type: 'api_key',
            exists_in_keychain: false,
            last_set: '2026-04-06T10:00:00Z',
            rotate_after_days: 90,
          },
        },
        mcp_servers: {
          github: {
            transport: 'sse',
            url: 'https://api.github.com/mcp',
            credential: 'my-key',
            status: 'healthy',
            tools_discovered: ['repos_list'],
          },
        },
        profiles: {
          default: {
            session_token_hash: 'hash123',
            allowed_servers: ['github'],
            tools_exposed_count: 5,
          },
        },
        generated_configs: {},
      }

      writeState(tmpDir, state)
      const loaded = loadState(tmpDir)

      expect(loaded.version).toBe('0.1')
      expect(loaded.last_applied).toBe('2026-04-06T10:00:00Z')
      expect(loaded.credentials['my-key'].rotate_after_days).toBe(90)
      expect(loaded.mcp_servers.github.transport).toBe('sse')
      expect(loaded.profiles.default.tools_exposed_count).toBe(5)
    })

    it('should perform atomic write (no .tmp file left behind)', () => {
      const state = createEmptyState()
      writeState(tmpDir, state)

      const tmpPath = join(tmpDir, 'state.json.tmp')
      const statePath = join(tmpDir, 'state.json')

      expect(existsSync(tmpPath)).toBe(false)
      expect(existsSync(statePath)).toBe(true)
    })

    it('should overwrite existing state file', () => {
      const state1 = createEmptyState()
      state1.applied_config_hash = 'first'
      writeState(tmpDir, state1)

      const state2 = createEmptyState()
      state2.applied_config_hash = 'second'
      writeState(tmpDir, state2)

      const loaded = loadState(tmpDir)
      expect(loaded.applied_config_hash).toBe('second')
    })

    it('should produce valid JSON with formatting', () => {
      const state = createEmptyState()
      writeState(tmpDir, state)

      const raw = readFileSync(join(tmpDir, 'state.json'), 'utf-8')
      // Should be pretty-printed (have newlines) and end with newline
      expect(raw).toContain('\n')
      expect(raw.endsWith('\n')).toBe(true)
      // Should parse as valid JSON
      expect(() => JSON.parse(raw)).not.toThrow()
    })
  })
})
