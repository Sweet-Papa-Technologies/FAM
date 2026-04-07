/**
 * knowledge/store.ts — SQLite-backed knowledge store with full-text search.
 *
 * Uses FTS5 for efficient text search across keys and values.
 * Tags are stored as JSON arrays and included in the FTS index
 * so agents can search by tag content.
 */

import Database from 'better-sqlite3'
import type { KnowledgeEntry, KnowledgeFilters, KnowledgeSearchResult } from './types.js'

// ─── Row type from SQLite ─────────────────────────────────────────

interface KnowledgeRow {
  id: number
  key: string
  value: string
  namespace: string
  tags: string
  created_at: string
  updated_at: string
  created_by: string
}

// ─── KnowledgeStore Class ─────────────────────────────────────────

export class KnowledgeStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
  }

  // ─── Schema Initialization ────────────────────────────────────────

  private init(): void {
    // Create main table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'global',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT NOT NULL DEFAULT 'system',
        UNIQUE(key, namespace)
      )
    `)

    // Create FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        key, value, namespace, tags,
        content='knowledge',
        content_rowid='id'
      )
    `)

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, key, value, namespace, tags) VALUES (new.id, new.key, new.value, new.namespace, new.tags);
      END
    `)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, namespace, tags) VALUES('delete', old.id, old.key, old.value, old.namespace, old.tags);
      END
    `)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, namespace, tags) VALUES('delete', old.id, old.key, old.value, old.namespace, old.tags);
        INSERT INTO knowledge_fts(rowid, key, value, namespace, tags) VALUES (new.id, new.key, new.value, new.namespace, new.tags);
      END
    `)
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Upsert a knowledge entry.
   *
   * If a key already exists in the given namespace, the value,
   * tags, updated_at, and created_by fields are updated.
   *
   * @param key - Unique key within the namespace
   * @param value - The knowledge content
   * @param opts - Optional namespace, tags, and createdBy
   */
  set(
    key: string,
    value: string,
    opts?: { namespace?: string; tags?: string[]; createdBy?: string },
  ): void {
    const namespace = opts?.namespace ?? 'global'
    const tags = JSON.stringify(opts?.tags ?? [])
    const createdBy = opts?.createdBy ?? 'system'

    this.db
      .prepare(
        `INSERT INTO knowledge (key, value, namespace, tags, created_by)
         VALUES (@key, @value, @namespace, @tags, @createdBy)
         ON CONFLICT(key, namespace) DO UPDATE SET
           value = @value,
           tags = @tags,
           updated_at = datetime('now'),
           created_by = @createdBy`,
      )
      .run({ key, value, namespace, tags, createdBy })
  }

  /**
   * Retrieve a knowledge entry by key and namespace.
   *
   * @param key - The entry key
   * @param namespace - Namespace to search in (default: 'global')
   * @returns The entry, or undefined if not found
   */
  get(key: string, namespace?: string): KnowledgeEntry | undefined {
    const ns = namespace ?? 'global'
    const row = this.db
      .prepare('SELECT * FROM knowledge WHERE key = @key AND namespace = @ns')
      .get({ key, ns }) as KnowledgeRow | undefined

    if (!row) return undefined
    return this.rowToEntry(row)
  }

  /**
   * Full-text search across knowledge entries.
   *
   * Uses FTS5 MATCH for efficient text search across keys,
   * values, namespaces, and tags. Results are ranked by relevance.
   *
   * @param query - FTS5 search query
   * @param filters - Optional namespace filter and pagination
   * @returns Search results with total count
   */
  search(query: string, filters?: KnowledgeFilters): KnowledgeSearchResult {
    const limit = filters?.limit ?? 20
    const offset = filters?.offset ?? 0

    // Build FTS query with optional namespace filter
    let sql: string
    let countSql: string
    const params: Record<string, string | number> = { query, limit, offset }

    if (filters?.namespace) {
      sql = `SELECT k.* FROM knowledge k
             JOIN knowledge_fts fts ON k.id = fts.rowid
             WHERE knowledge_fts MATCH @query AND k.namespace = @namespace
             ORDER BY rank
             LIMIT @limit OFFSET @offset`
      countSql = `SELECT COUNT(*) as total FROM knowledge k
                  JOIN knowledge_fts fts ON k.id = fts.rowid
                  WHERE knowledge_fts MATCH @query AND k.namespace = @namespace`
      params.namespace = filters.namespace
    } else {
      sql = `SELECT k.* FROM knowledge k
             JOIN knowledge_fts fts ON k.id = fts.rowid
             WHERE knowledge_fts MATCH @query
             ORDER BY rank
             LIMIT @limit OFFSET @offset`
      countSql = `SELECT COUNT(*) as total FROM knowledge k
                  JOIN knowledge_fts fts ON k.id = fts.rowid
                  WHERE knowledge_fts MATCH @query`
    }

    const rows = this.db.prepare(sql).all(params) as KnowledgeRow[]
    const countRow = this.db.prepare(countSql).get(params) as { total: number }

    return {
      entries: rows.map((row) => this.rowToEntry(row)),
      total: countRow.total,
    }
  }

  /**
   * List knowledge entries with optional filters and pagination.
   *
   * @param filters - Optional namespace, tags, key, createdBy, limit, offset
   * @returns Paginated list with total count
   */
  list(filters?: KnowledgeFilters): KnowledgeSearchResult {
    const limit = filters?.limit ?? 50
    const offset = filters?.offset ?? 0
    const conditions: string[] = []
    const params: Record<string, string | number> = { limit, offset }

    if (filters?.namespace) {
      conditions.push('namespace = @namespace')
      params.namespace = filters.namespace
    }

    if (filters?.key) {
      conditions.push('key = @key')
      params.key = filters.key
    }

    if (filters?.created_by) {
      conditions.push('created_by = @createdBy')
      params.createdBy = filters.created_by
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sql = `SELECT * FROM knowledge ${whereClause}
                 ORDER BY updated_at DESC
                 LIMIT @limit OFFSET @offset`
    const countSql = `SELECT COUNT(*) as total FROM knowledge ${whereClause}`

    const rows = this.db.prepare(sql).all(params) as KnowledgeRow[]
    const countRow = this.db.prepare(countSql).get(params) as { total: number }

    return {
      entries: rows.map((row) => this.rowToEntry(row)),
      total: countRow.total,
    }
  }

  /**
   * Delete a knowledge entry by key and namespace.
   *
   * @param key - The entry key
   * @param namespace - Namespace (default: 'global')
   * @returns true if an entry was deleted, false if not found
   */
  delete(key: string, namespace?: string): boolean {
    const ns = namespace ?? 'global'
    const result = this.db
      .prepare('DELETE FROM knowledge WHERE key = @key AND namespace = @ns')
      .run({ key, ns })

    return result.changes > 0
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close()
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  /**
   * Convert a raw SQLite row to a KnowledgeEntry with parsed tags.
   */
  private rowToEntry(row: KnowledgeRow): KnowledgeEntry {
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      namespace: row.namespace,
      tags: JSON.parse(row.tags) as string[],
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
    }
  }
}
