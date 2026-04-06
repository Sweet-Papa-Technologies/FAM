/**
 * daemon/tool-registry.ts — Unified tool registry with namespace prefixing.
 *
 * Manages all MCP tools (upstream + native), applies namespace
 * prefixes, and builds per-profile filtered views based on
 * allowed_servers. Based on DESIGN.md Sections 5.5 and 7.2.
 */

import type { ToolEntry, ToolDefinition } from './types.js'
import logger from '../utils/logger.js'

export class ToolRegistry {
  private static TOOL_NAME_PATTERN = /^[a-zA-Z0-9_\-\.]+$/
  private tools: Map<string, ToolEntry> = new Map()
  private profileViews: Map<string, ToolEntry[]> = new Map()

  /**
   * Register tools discovered from an upstream MCP server.
   *
   * Each tool name is prefixed with the server namespace using
   * the double-underscore separator (e.g., "github__repos_list").
   * Descriptions are prefixed with [namespace] for agent clarity.
   *
   * @param namespace - The server namespace (e.g., "github")
   * @param tools - Tool definitions from the upstream server's tools/list
   */
  registerUpstreamTools(namespace: string, tools: ToolDefinition[]): void {
    for (const tool of tools) {
      // Validate tool name — reject names with special chars or namespace separator
      if (!ToolRegistry.TOOL_NAME_PATTERN.test(tool.name)) {
        logger.warn({ namespace, toolName: tool.name }, 'Rejected invalid tool name from upstream')
        continue
      }
      if (tool.name.includes('__')) {
        logger.warn({ namespace, toolName: tool.name }, 'Rejected tool name containing namespace separator')
        continue
      }
      const namespacedName = `${namespace}__${tool.name}`
      const entry: ToolEntry = {
        namespacedName,
        upstreamName: tool.name,
        namespace,
        description: `[${namespace}] ${tool.description}`,
        inputSchema: tool.inputSchema,
        source: 'upstream',
      }
      this.tools.set(namespacedName, entry)
    }
  }

  /**
   * Register FAM's native tools (fam__whoami, etc.).
   *
   * Native tools already have the fam__ prefix in their
   * namespacedName. They are included in every profile's view.
   *
   * @param tools - Native tool entries
   */
  registerNativeTools(tools: ToolEntry[]): void {
    for (const tool of tools) {
      this.tools.set(tool.namespacedName, tool)
    }
  }

  /**
   * Build per-profile filtered views of the tool registry.
   *
   * Each profile sees only tools from its allowed servers,
   * minus any in denied_servers. Native tools (fam__*) are
   * included in every profile.
   *
   * @param profiles - Map of profile name to config with allowedServers/deniedServers
   */
  buildProfileViews(
    profiles: Record<string, { allowed_servers: string[]; denied_servers?: string[] }>,
  ): void {
    this.profileViews.clear()

    for (const [profileName, profileConfig] of Object.entries(profiles)) {
      const allowedSet = new Set(profileConfig.allowed_servers)
      const deniedSet = new Set(profileConfig.denied_servers ?? [])

      const view: ToolEntry[] = []
      for (const tool of this.tools.values()) {
        // Native tools are always included
        if (tool.source === 'native') {
          view.push(tool)
          continue
        }

        // Upstream tools must be in allowed and not in denied
        if (allowedSet.has(tool.namespace) && !deniedSet.has(tool.namespace)) {
          view.push(tool)
        }
      }

      this.profileViews.set(profileName, view)
    }
  }

  /**
   * Get the filtered tool list for a specific profile.
   *
   * Returns ToolDefinition[] (name, description, inputSchema)
   * suitable for MCP tools/list responses.
   *
   * @param profile - The profile name
   * @returns Filtered tool definitions, or empty array if profile unknown
   */
  getToolsForProfile(profile: string): ToolDefinition[] {
    const view = this.profileViews.get(profile)
    if (!view) return []

    return view.map((entry) => ({
      name: entry.namespacedName,
      description: entry.description,
      inputSchema: entry.inputSchema,
    }))
  }

  /**
   * Resolve a namespaced tool call back to its namespace and upstream name.
   *
   * Splits on '__' to extract namespace and original tool name.
   * Handles tools with '__' in the upstream name by rejoining.
   *
   * @param toolName - The namespaced tool name (e.g., "github__repos_list")
   * @returns Resolution result, or null if tool not found
   */
  resolveToolCall(
    toolName: string,
  ): { namespace: string; upstreamName: string; source: 'upstream' | 'native' } | null {
    const entry = this.tools.get(toolName)
    if (!entry) return null

    return {
      namespace: entry.namespace,
      upstreamName: entry.upstreamName,
      source: entry.source,
    }
  }

  /**
   * Get all unique server namespaces in the registry.
   */
  getAllNamespaces(): string[] {
    const namespaces = new Set<string>()
    for (const entry of this.tools.values()) {
      if (entry.source === 'upstream') {
        namespaces.add(entry.namespace)
      }
    }
    return [...namespaces]
  }

  /**
   * Get total count of registered tools (upstream + native).
   */
  getToolCount(): number {
    return this.tools.size
  }

  /**
   * Get tool count per namespace.
   */
  getToolCountByNamespace(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of this.tools.values()) {
      const ns = entry.namespace
      counts[ns] = (counts[ns] ?? 0) + 1
    }
    return counts
  }

  /**
   * Check if a specific profile has access to a given namespace.
   *
   * @param profile - The profile name
   * @param namespace - The server namespace
   * @returns true if the profile can access tools in this namespace
   */
  isNamespaceAllowedForProfile(profile: string, namespace: string): boolean {
    const view = this.profileViews.get(profile)
    if (!view) return false
    return view.some((entry) => entry.namespace === namespace)
  }

  /**
   * Clear all registered tools and profile views.
   * Used during hot-reload to rebuild from scratch.
   */
  clear(): void {
    this.tools.clear()
    this.profileViews.clear()
  }
}
