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
import type { ToolRegistry } from './tool-registry.js'
import type { IAuditLogger } from '../audit/types.js'

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
      version: '0.1.0',
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
