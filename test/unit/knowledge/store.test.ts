/**
 * test/unit/knowledge/store.test.ts — KnowledgeStore unit tests.
 *
 * Tests CRUD operations, FTS5 search, pagination, namespace
 * isolation, and tag storage/retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KnowledgeStore } from '../../../src/knowledge/store.js'

describe('KnowledgeStore', () => {
  let store: KnowledgeStore

  beforeEach(() => {
    store = new KnowledgeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  // ─── set / get round-trip ─────────────────────────────────────────

  describe('set and get', () => {
    it('should store and retrieve a knowledge entry', () => {
      store.set('api-pattern', 'Use REST for CRUD, GraphQL for reads', {
        namespace: 'global',
        tags: ['api', 'architecture'],
        createdBy: 'claude-code',
      })

      const entry = store.get('api-pattern', 'global')
      expect(entry).toBeDefined()
      expect(entry!.key).toBe('api-pattern')
      expect(entry!.value).toBe('Use REST for CRUD, GraphQL for reads')
      expect(entry!.namespace).toBe('global')
      expect(entry!.tags).toEqual(['api', 'architecture'])
      expect(entry!.created_by).toBe('claude-code')
      expect(entry!.created_at).toBeDefined()
      expect(entry!.updated_at).toBeDefined()
    })

    it('should use default namespace when not specified', () => {
      store.set('key1', 'value1')
      const entry = store.get('key1')
      expect(entry).toBeDefined()
      expect(entry!.namespace).toBe('global')
    })

    it('should return undefined for non-existent key', () => {
      const entry = store.get('nonexistent')
      expect(entry).toBeUndefined()
    })

    it('should return undefined for key in wrong namespace', () => {
      store.set('key1', 'value1', { namespace: 'project-a' })
      const entry = store.get('key1', 'global')
      expect(entry).toBeUndefined()
    })
  })

  // ─── Upsert behavior ─────────────────────────────────────────────

  describe('upsert', () => {
    it('should overwrite existing key in same namespace', () => {
      store.set('key1', 'original-value', { namespace: 'global' })
      store.set('key1', 'updated-value', { namespace: 'global' })

      const entry = store.get('key1', 'global')
      expect(entry).toBeDefined()
      expect(entry!.value).toBe('updated-value')
    })

    it('should update tags on upsert', () => {
      store.set('key1', 'value1', { tags: ['old-tag'] })
      store.set('key1', 'value1', { tags: ['new-tag-1', 'new-tag-2'] })

      const entry = store.get('key1')
      expect(entry!.tags).toEqual(['new-tag-1', 'new-tag-2'])
    })

    it('should create separate entries for different namespaces', () => {
      store.set('key1', 'value-global', { namespace: 'global' })
      store.set('key1', 'value-project', { namespace: 'project-a' })

      const globalEntry = store.get('key1', 'global')
      const projectEntry = store.get('key1', 'project-a')

      expect(globalEntry!.value).toBe('value-global')
      expect(projectEntry!.value).toBe('value-project')
    })
  })

  // ─── FTS5 search ──────────────────────────────────────────────────

  describe('search', () => {
    beforeEach(() => {
      store.set('typescript-strict', 'Always enable strict mode in tsconfig.json', {
        tags: ['typescript', 'config'],
        createdBy: 'claude-code',
      })
      store.set('testing-pattern', 'Use vitest with describe/it blocks', {
        tags: ['testing', 'vitest'],
        createdBy: 'claude-code',
      })
      store.set('api-design', 'REST endpoints should use plural nouns', {
        namespace: 'backend',
        tags: ['api', 'rest'],
        createdBy: 'cursor',
      })
    })

    it('should find entries matching value text', () => {
      const results = store.search('strict mode')
      expect(results.entries.length).toBeGreaterThan(0)
      expect(results.entries[0].key).toBe('typescript-strict')
    })

    it('should find entries matching key text', () => {
      const results = store.search('typescript')
      expect(results.entries.length).toBeGreaterThan(0)
      expect(results.entries.some((e) => e.key === 'typescript-strict')).toBe(true)
    })

    it('should find entries matching tags', () => {
      const results = store.search('vitest')
      expect(results.entries.length).toBeGreaterThan(0)
      expect(results.entries[0].key).toBe('testing-pattern')
    })

    it('should filter search by namespace', () => {
      const results = store.search('REST', { namespace: 'backend' })
      expect(results.entries.length).toBe(1)
      expect(results.entries[0].key).toBe('api-design')

      const globalResults = store.search('REST', { namespace: 'global' })
      expect(globalResults.entries.length).toBe(0)
    })

    it('should return total count', () => {
      const results = store.search('typescript OR vitest OR REST')
      expect(results.total).toBeGreaterThanOrEqual(1)
    })

    it('should return empty results for no matches', () => {
      const results = store.search('xyznonexistent')
      expect(results.entries).toHaveLength(0)
      expect(results.total).toBe(0)
    })

    it('should respect limit', () => {
      const results = store.search('typescript OR vitest OR REST', { limit: 1 })
      expect(results.entries.length).toBeLessThanOrEqual(1)
    })
  })

  // ─── list with pagination ─────────────────────────────────────────

  describe('list', () => {
    beforeEach(() => {
      for (let i = 1; i <= 5; i++) {
        store.set(`entry-${i}`, `Value ${i}`, {
          namespace: i <= 3 ? 'global' : 'project',
          tags: [`tag-${i}`],
        })
      }
    })

    it('should list all entries', () => {
      const results = store.list()
      expect(results.entries).toHaveLength(5)
      expect(results.total).toBe(5)
    })

    it('should filter by namespace', () => {
      const results = store.list({ namespace: 'global' })
      expect(results.entries).toHaveLength(3)
      expect(results.total).toBe(3)
    })

    it('should respect limit', () => {
      const results = store.list({ limit: 2 })
      expect(results.entries).toHaveLength(2)
      expect(results.total).toBe(5)
    })

    it('should support offset for pagination', () => {
      const page1 = store.list({ limit: 2, offset: 0 })
      const page2 = store.list({ limit: 2, offset: 2 })

      expect(page1.entries).toHaveLength(2)
      expect(page2.entries).toHaveLength(2)

      // Pages should have different entries
      const page1Keys = page1.entries.map((e) => e.key)
      const page2Keys = page2.entries.map((e) => e.key)
      expect(page1Keys).not.toEqual(page2Keys)
    })
  })

  // ─── delete ───────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete an existing entry', () => {
      store.set('to-delete', 'some value')
      const deleted = store.delete('to-delete')
      expect(deleted).toBe(true)

      const entry = store.get('to-delete')
      expect(entry).toBeUndefined()
    })

    it('should return false for non-existent key', () => {
      const deleted = store.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('should only delete from specified namespace', () => {
      store.set('shared-key', 'global-value', { namespace: 'global' })
      store.set('shared-key', 'project-value', { namespace: 'project' })

      const deleted = store.delete('shared-key', 'global')
      expect(deleted).toBe(true)

      // Project namespace entry should still exist
      const remaining = store.get('shared-key', 'project')
      expect(remaining).toBeDefined()
      expect(remaining!.value).toBe('project-value')
    })

    it('should remove entry from FTS index after delete', () => {
      store.set('searchable', 'uniquefindablecontent')
      store.delete('searchable')

      const results = store.search('uniquefindablecontent')
      expect(results.entries).toHaveLength(0)
    })
  })

  // ─── tags ─────────────────────────────────────────────────────────

  describe('tags', () => {
    it('should store and retrieve tags correctly', () => {
      store.set('tagged', 'value', { tags: ['alpha', 'beta', 'gamma'] })
      const entry = store.get('tagged')
      expect(entry!.tags).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('should default to empty tags array', () => {
      store.set('no-tags', 'value')
      const entry = store.get('no-tags')
      expect(entry!.tags).toEqual([])
    })
  })

  // ─── close ────────────────────────────────────────────────────────

  describe('close', () => {
    it('should close without error', () => {
      expect(() => store.close()).not.toThrow()
    })
  })
})
