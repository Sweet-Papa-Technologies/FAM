/**
 * daemon/native-tools.ts — FAM's own MCP tools.
 *
 * These tools appear alongside proxied upstream tools in every
 * profile's tools/list response. They provide introspection,
 * audit logging, and health monitoring. Based on DESIGN.md
 * Section 7.5.
 */

import type {
  ToolEntry,
  ToolDefinition,
  McpResult,
  CallContext,
} from './types.js'
import { FAM_VERSION } from '../utils/version.js'
import type { ToolRegistry } from './tool-registry.js'
import type { IAuditLogger } from '../audit/types.js'
import type { KnowledgeStore } from '../knowledge/index.js'

// ─── Tool Definitions ─────────────────────────────────────────────

/**
 * Return ToolDefinition[] for all native tools (fam__*).
 *
 * These are the "batteries included" tools that every FAM
 * profile has access to regardless of server configuration.
 */
export function getNativeToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'fam__whoami',
      description: 'Returns your profile name, allowed servers, and permissions',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'fam__log_action',
      description: 'Report a significant action for the audit trail',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action name (e.g., "file_edit", "deploy")',
          },
          description: {
            type: 'string',
            description: 'What happened',
          },
          metadata: {
            type: 'object',
            description: 'Optional extra data',
          },
        },
        required: ['action', 'description'],
        additionalProperties: false,
      },
    },
    {
      name: 'fam__list_servers',
      description: 'Returns available MCP servers for your profile with status',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'fam__health',
      description: 'Daemon and server reachability status',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'fam__get_knowledge',
      description: 'Retrieve a knowledge entry by key',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Knowledge entry key' },
          namespace: { type: 'string', description: 'Namespace (default: global)' },
        },
        required: ['key'],
      },
    },
    {
      name: 'fam__set_knowledge',
      description: 'Store a knowledge entry (upsert)',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Knowledge entry key' },
          value: { type: 'string', description: 'Knowledge entry value' },
          namespace: { type: 'string', description: 'Namespace (default: global)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'fam__search_knowledge',
      description: 'Full-text search across knowledge entries',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          namespace: { type: 'string', description: 'Filter by namespace' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'fam__get_audit_log',
      description: 'Query the audit trail',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'Filter by profile' },
          server: { type: 'string', description: 'Filter by server namespace' },
          limit: { type: 'number', description: 'Max entries (default: 50)' },
          since: { type: 'string', description: 'ISO timestamp to filter from' },
        },
      },
    },
    {
      name: 'fam__list_profiles',
      description: 'List all configured profiles with access details',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ]
}

/**
 * Build ToolEntry[] from native tool definitions for registry insertion.
 */
export function getNativeToolEntries(): ToolEntry[] {
  return getNativeToolDefinitions().map((def) => ({
    namespacedName: def.name,
    upstreamName: def.name.replace('fam__', ''),
    namespace: 'fam',
    description: def.description,
    inputSchema: def.inputSchema,
    source: 'native' as const,
  }))
}

// ─── Dependencies for native tool handlers ────────────────────────

export interface NativeToolDeps {
  registry: ToolRegistry
  audit: IAuditLogger
  startTime: number
  serverStatuses?: Record<string, { status: string; toolCount: number; lastReachable?: string }>
  profileConfig?: {
    allowed_servers: string[]
    denied_servers: string[]
  }
  knowledge?: KnowledgeStore
  allProfiles?: Record<string, { description: string; allowed_servers: string[]; denied_servers: string[] }>
}

// ─── Handler dispatch ─────────────────────────────────────────────

/**
 * Handle a native tool call.
 *
 * @param name - Tool name without fam__ prefix (e.g., "whoami")
 * @param args - Tool arguments (validated per inputSchema)
 * @param ctx - Call context (profile name, etc.)
 * @param deps - Dependencies (registry, audit, etc.)
 * @returns MCP-formatted result
 */
export async function handleNativeTool(
  name: string,
  args: unknown,
  ctx: CallContext,
  deps: NativeToolDeps,
): Promise<McpResult> {
  switch (name) {
    case 'whoami':
      return handleWhoami(ctx, deps)
    case 'log_action':
      return handleLogAction(args, ctx, deps)
    case 'list_servers':
      return handleListServers(ctx, deps)
    case 'health':
      return handleHealth(deps)
    case 'get_knowledge':
      return handleGetKnowledge(args, deps)
    case 'set_knowledge':
      return handleSetKnowledge(args, ctx, deps)
    case 'search_knowledge':
      return handleSearchKnowledge(args, deps)
    case 'get_audit_log':
      return handleGetAuditLog(args, deps)
    case 'list_profiles':
      return handleListProfiles(deps)
    default:
      return {
        content: [{ type: 'text', text: `Unknown native tool: ${name}` }],
        isError: true,
      }
  }
}

// ─── Individual handlers ──────────────────────────────────────────

function handleWhoami(ctx: CallContext, deps: NativeToolDeps): McpResult {
  const tools = deps.registry.getToolsForProfile(ctx.profile)
  const profileConfig = deps.profileConfig ?? {
    allowed_servers: [],
    denied_servers: [],
  }

  const result = {
    profile: ctx.profile,
    allowed_servers: profileConfig.allowed_servers,
    denied_servers: profileConfig.denied_servers,
    tool_count: tools.length,
    native_tools: [
      'fam__whoami',
      'fam__log_action',
      'fam__list_servers',
      'fam__health',
      'fam__get_knowledge',
      'fam__set_knowledge',
      'fam__search_knowledge',
      'fam__get_audit_log',
      'fam__list_profiles',
    ],
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

function handleLogAction(
  args: unknown,
  ctx: CallContext,
  deps: NativeToolDeps,
): McpResult {
  // Validate required args
  if (!args || typeof args !== 'object') {
    return {
      content: [{ type: 'text', text: 'Invalid arguments: expected { action, description }' }],
      isError: true,
    }
  }

  const { action, description, metadata } = args as Record<string, unknown>

  if (typeof action !== 'string' || !action) {
    return {
      content: [{ type: 'text', text: 'Missing required field: action' }],
      isError: true,
    }
  }

  if (typeof description !== 'string' || !description) {
    return {
      content: [{ type: 'text', text: 'Missing required field: description' }],
      isError: true,
    }
  }

  // Write to audit log
  deps.audit.logConfigChange({
    action: 'agent_report',
    target: ctx.profile,
    details: JSON.stringify({
      reported_action: action,
      description,
      metadata: metadata ?? undefined,
    }),
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ logged: true }) }],
  }
}

function handleListServers(ctx: CallContext, deps: NativeToolDeps): McpResult {
  const profileTools = deps.registry.getToolsForProfile(ctx.profile)
  const serverStatuses = deps.serverStatuses ?? {}

  // Collect unique namespaces visible to this profile (excluding fam)
  const namespaces = new Set<string>()
  for (const tool of profileTools) {
    const parts = tool.name.split('__')
    if (parts[0] !== 'fam') {
      namespaces.add(parts[0])
    }
  }

  const servers = [...namespaces].map((ns) => {
    const status = serverStatuses[ns]
    const toolCount = profileTools.filter((t) => t.name.startsWith(`${ns}__`)).length
    return {
      name: ns,
      status: status?.status ?? 'unknown',
      tool_count: toolCount,
      last_reachable: status?.lastReachable,
    }
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ servers }, null, 2) }],
  }
}

function handleHealth(deps: NativeToolDeps): McpResult {
  const uptimeSeconds = Math.floor((Date.now() - deps.startTime) / 1000)
  const serverStatuses = deps.serverStatuses ?? {}

  const result = {
    daemon: {
      status: 'healthy',
      uptime_seconds: uptimeSeconds,
      version: FAM_VERSION,
    },
    servers: Object.fromEntries(
      Object.entries(serverStatuses).map(([ns, info]) => [
        ns,
        {
          status: info.status,
          tool_count: info.toolCount,
          last_reachable: info.lastReachable,
        },
      ]),
    ),
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

// ─── Knowledge handlers ──────────────────────────────────────────

function handleGetKnowledge(args: unknown, deps: NativeToolDeps): McpResult {
  if (!deps.knowledge) {
    return {
      content: [{ type: 'text', text: 'Knowledge store is not initialized' }],
      isError: true,
    }
  }

  const { key, namespace } = (args ?? {}) as Record<string, unknown>

  if (typeof key !== 'string' || !key) {
    return {
      content: [{ type: 'text', text: 'Missing required field: key' }],
      isError: true,
    }
  }

  const entry = deps.knowledge.get(key, typeof namespace === 'string' ? namespace : undefined)
  if (!entry) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ found: false, key }) }],
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
  }
}

function handleSetKnowledge(
  args: unknown,
  ctx: CallContext,
  deps: NativeToolDeps,
): McpResult {
  if (!deps.knowledge) {
    return {
      content: [{ type: 'text', text: 'Knowledge store is not initialized' }],
      isError: true,
    }
  }

  if (!args || typeof args !== 'object') {
    return {
      content: [{ type: 'text', text: 'Invalid arguments: expected { key, value }' }],
      isError: true,
    }
  }

  const { key, value, namespace, tags } = args as Record<string, unknown>

  if (typeof key !== 'string' || !key) {
    return {
      content: [{ type: 'text', text: 'Missing required field: key' }],
      isError: true,
    }
  }

  if (typeof value !== 'string' || !value) {
    return {
      content: [{ type: 'text', text: 'Missing required field: value' }],
      isError: true,
    }
  }

  deps.knowledge.set(key, value, {
    namespace: typeof namespace === 'string' ? namespace : undefined,
    tags: Array.isArray(tags) ? (tags as string[]) : undefined,
    createdBy: ctx.profile,
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ stored: true, key }) }],
  }
}

function handleSearchKnowledge(args: unknown, deps: NativeToolDeps): McpResult {
  if (!deps.knowledge) {
    return {
      content: [{ type: 'text', text: 'Knowledge store is not initialized' }],
      isError: true,
    }
  }

  const { query, namespace, limit } = (args ?? {}) as Record<string, unknown>

  if (typeof query !== 'string' || !query) {
    return {
      content: [{ type: 'text', text: 'Missing required field: query' }],
      isError: true,
    }
  }

  const results = deps.knowledge.search(query, {
    namespace: typeof namespace === 'string' ? namespace : undefined,
    limit: typeof limit === 'number' ? limit : undefined,
  })

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  }
}

// ─── Audit log handler ───────────────────────────────────────────

function handleGetAuditLog(args: unknown, deps: NativeToolDeps): McpResult {
  const { profile, server, limit, since } = (args ?? {}) as Record<string, unknown>

  const entries = deps.audit.query({
    profile: typeof profile === 'string' ? profile : undefined,
    serverNs: typeof server === 'string' ? server : undefined,
    limit: typeof limit === 'number' ? limit : undefined,
    since: typeof since === 'string' ? since : undefined,
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ entries, count: entries.length }, null, 2) }],
  }
}

// ─── Profile listing handler ─────────────────────────────────────

function handleListProfiles(deps: NativeToolDeps): McpResult {
  const allProfiles = deps.allProfiles ?? {}

  const profiles = Object.entries(allProfiles).map(([name, config]) => ({
    name,
    description: config.description,
    allowed_servers: config.allowed_servers,
    denied_servers: config.denied_servers,
  }))

  return {
    content: [{ type: 'text', text: JSON.stringify({ profiles }, null, 2) }],
  }
}
