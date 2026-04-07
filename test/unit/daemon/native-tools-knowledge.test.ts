/**
 * test/unit/daemon/native-tools-knowledge.test.ts — Knowledge native tool tests.
 *
 * Tests the 5 new native tools:
 *   fam__get_knowledge, fam__set_knowledge, fam__search_knowledge,
 *   fam__get_audit_log, fam__list_profiles
 *
 * Uses mocks for KnowledgeStore and AuditLogger dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleNativeTool } from '../../../src/daemon/native-tools.js'
import type { NativeToolDeps } from '../../../src/daemon/native-tools.js'
import type { CallContext } from '../../../src/daemon/types.js'
import { ToolRegistry } from '../../../src/daemon/tool-registry.js'
import { MockAuditLogger } from '../../mocks/mcp-server.js'
import type { KnowledgeStore } from '../../../src/knowledge/index.js'
import type { KnowledgeEntry, KnowledgeSearchResult } from '../../../src/knowledge/index.js'

// ─── Mock KnowledgeStore ─────────────────────────────────────────

function createMockKnowledgeStore(): KnowledgeStore {
  const entries = new Map<string, KnowledgeEntry>()

  return {
    get: vi.fn((key: string, namespace?: string) => {
      const ns = namespace ?? 'global'
      return entries.get(`${ns}:${key}`)
    }),
    set: vi.fn((key: string, value: string, opts?: { namespace?: string; tags?: string[]; createdBy?: string }) => {
      const ns = opts?.namespace ?? 'global'
      entries.set(`${ns}:${key}`, {
        id: entries.size + 1,
        key,
        value,
        namespace: ns,
        tags: opts?.tags ?? [],
        created_at: '2026-04-06T12:00:00',
        updated_at: '2026-04-06T12:00:00',
        created_by: opts?.createdBy ?? 'system',
      })
    }),
    search: vi.fn((_query: string, _filters?: unknown): KnowledgeSearchResult => ({
      entries: [],
      total: 0,
    })),
    list: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  } as unknown as KnowledgeStore
}

// ─── Test Suite ──────────────────────────────────────────────────

describe('Native Tools — Knowledge & Profiles', () => {
  let registry: ToolRegistry
  let audit: MockAuditLogger
  let knowledge: KnowledgeStore
  let deps: NativeToolDeps
  let ctx: CallContext

  beforeEach(() => {
    registry = new ToolRegistry()
    audit = new MockAuditLogger()
    knowledge = createMockKnowledgeStore()

    deps = {
      registry,
      audit: audit as unknown as NativeToolDeps['audit'],
      startTime: Date.now() - 3600_000,
      knowledge,
      allProfiles: {
        'claude-code': {
          description: 'Profile for Claude Code',
          allowed_servers: ['github', 'jira'],
          denied_servers: [],
        },
        'cursor': {
          description: 'Profile for Cursor',
          allowed_servers: ['github'],
          denied_servers: ['jira'],
        },
      },
    }

    ctx = { profile: 'claude-code' }
  })

  // ─── fam__get_knowledge ─────────────────────────────────────────

  describe('handleNativeTool — get_knowledge', () => {
    it('should return entry for given key', async () => {
      // Seed the mock store
      knowledge.set('api-key', 'Use REST patterns', { tags: ['api'] })

      const result = await handleNativeTool(
        'get_knowledge',
        { key: 'api-key' },
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.key).toBe('api-key')
      expect(data.value).toBe('Use REST patterns')
    })

    it('should return not found for missing key', async () => {
      const result = await handleNativeTool(
        'get_knowledge',
        { key: 'nonexistent' },
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.found).toBe(false)
    })

    it('should pass namespace to store', async () => {
      await handleNativeTool(
        'get_knowledge',
        { key: 'test-key', namespace: 'project-a' },
        ctx,
        deps,
      )

      expect(knowledge.get).toHaveBeenCalledWith('test-key', 'project-a')
    })

    it('should return error when knowledge store is not initialized', async () => {
      const noDeps = { ...deps, knowledge: undefined }
      const result = await handleNativeTool(
        'get_knowledge',
        { key: 'test-key' },
        ctx,
        noDeps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not initialized')
    })

    it('should return error for missing key', async () => {
      const result = await handleNativeTool(
        'get_knowledge',
        {},
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('key')
    })
  })

  // ─── fam__set_knowledge ─────────────────────────────────────────

  describe('handleNativeTool — set_knowledge', () => {
    it('should store entry and return { stored: true }', async () => {
      const result = await handleNativeTool(
        'set_knowledge',
        { key: 'new-key', value: 'new-value', tags: ['tag1'] },
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.stored).toBe(true)
      expect(data.key).toBe('new-key')

      // Verify store.set was called
      expect(knowledge.set).toHaveBeenCalledWith('new-key', 'new-value', {
        namespace: undefined,
        tags: ['tag1'],
        createdBy: 'claude-code',
      })
    })

    it('should pass namespace to store', async () => {
      await handleNativeTool(
        'set_knowledge',
        { key: 'k', value: 'v', namespace: 'my-ns' },
        ctx,
        deps,
      )

      expect(knowledge.set).toHaveBeenCalledWith('k', 'v', expect.objectContaining({
        namespace: 'my-ns',
      }))
    })

    it('should return error for missing key', async () => {
      const result = await handleNativeTool(
        'set_knowledge',
        { value: 'some-value' },
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
    })

    it('should return error for missing value', async () => {
      const result = await handleNativeTool(
        'set_knowledge',
        { key: 'some-key' },
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
    })

    it('should return error when knowledge store is not initialized', async () => {
      const noDeps = { ...deps, knowledge: undefined }
      const result = await handleNativeTool(
        'set_knowledge',
        { key: 'k', value: 'v' },
        ctx,
        noDeps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not initialized')
    })

    it('should return error for invalid args', async () => {
      const result = await handleNativeTool(
        'set_knowledge',
        null,
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
    })
  })

  // ─── fam__search_knowledge ──────────────────────────────────────

  describe('handleNativeTool — search_knowledge', () => {
    it('should return search results', async () => {
      const mockResults: KnowledgeSearchResult = {
        entries: [
          {
            id: 1,
            key: 'found',
            value: 'result-value',
            namespace: 'global',
            tags: [],
            created_at: '2026-04-06T12:00:00',
            updated_at: '2026-04-06T12:00:00',
            created_by: 'claude-code',
          },
        ],
        total: 1,
      }
      vi.mocked(knowledge.search).mockReturnValue(mockResults)

      const result = await handleNativeTool(
        'search_knowledge',
        { query: 'test query' },
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.entries).toHaveLength(1)
      expect(data.total).toBe(1)
      expect(data.entries[0].key).toBe('found')
    })

    it('should pass namespace and limit filters', async () => {
      await handleNativeTool(
        'search_knowledge',
        { query: 'test', namespace: 'backend', limit: 5 },
        ctx,
        deps,
      )

      expect(knowledge.search).toHaveBeenCalledWith('test', {
        namespace: 'backend',
        limit: 5,
      })
    })

    it('should return error for missing query', async () => {
      const result = await handleNativeTool(
        'search_knowledge',
        {},
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('query')
    })

    it('should return error when knowledge store is not initialized', async () => {
      const noDeps = { ...deps, knowledge: undefined }
      const result = await handleNativeTool(
        'search_knowledge',
        { query: 'test' },
        ctx,
        noDeps,
      )

      expect(result.isError).toBe(true)
    })
  })

  // ─── fam__get_audit_log ─────────────────────────────────────────

  describe('handleNativeTool — get_audit_log', () => {
    it('should return recent audit entries', async () => {
      // Seed audit log
      audit.logCall({
        profile: 'claude-code',
        serverNs: 'github',
        toolName: 'repos_list',
        status: 'success',
      })

      const result = await handleNativeTool(
        'get_audit_log',
        {},
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.entries).toBeDefined()
      expect(data.count).toBeDefined()
    })

    it('should pass filters to audit query', async () => {
      const querySpy = vi.spyOn(audit, 'query')

      await handleNativeTool(
        'get_audit_log',
        { profile: 'claude-code', limit: 10 },
        ctx,
        deps,
      )

      expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({
        profile: 'claude-code',
        limit: 10,
      }))
    })

    it('should handle empty args', async () => {
      const result = await handleNativeTool(
        'get_audit_log',
        null,
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
    })
  })

  // ─── fam__list_profiles ─────────────────────────────────────────

  describe('handleNativeTool — list_profiles', () => {
    it('should return profile list with details', async () => {
      const result = await handleNativeTool(
        'list_profiles',
        {},
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)

      expect(data.profiles).toBeDefined()
      expect(data.profiles).toHaveLength(2)

      const claude = data.profiles.find(
        (p: Record<string, unknown>) => p.name === 'claude-code',
      )
      expect(claude).toBeDefined()
      expect(claude.description).toBe('Profile for Claude Code')
      expect(claude.allowed_servers).toEqual(['github', 'jira'])
      expect(claude.denied_servers).toEqual([])

      const cursor = data.profiles.find(
        (p: Record<string, unknown>) => p.name === 'cursor',
      )
      expect(cursor).toBeDefined()
      expect(cursor.denied_servers).toEqual(['jira'])
    })

    it('should return empty profiles when allProfiles is undefined', async () => {
      const noDeps = { ...deps, allProfiles: undefined }
      const result = await handleNativeTool(
        'list_profiles',
        {},
        ctx,
        noDeps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.profiles).toEqual([])
    })
  })
})
