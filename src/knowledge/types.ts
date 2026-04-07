/**
 * knowledge/types.ts — Knowledge store type definitions.
 *
 * Defines the shapes for knowledge entries, query filters,
 * and search results used by the KnowledgeStore and its
 * consumers (CLI commands, native MCP tools).
 */

// ─── Knowledge Entry ──────────────────────────────────────────────

export interface KnowledgeEntry {
  id: number
  key: string
  value: string
  namespace: string
  tags: string[]
  created_at: string
  updated_at: string
  created_by: string // profile name that created it
}

// ─── Query Filters ────────────────────────────────────────────────

export interface KnowledgeFilters {
  namespace?: string
  tags?: string[]
  key?: string
  created_by?: string
  limit?: number
  offset?: number
}

// ─── Search Result ────────────────────────────────────────────────

export interface KnowledgeSearchResult {
  entries: KnowledgeEntry[]
  total: number
}
