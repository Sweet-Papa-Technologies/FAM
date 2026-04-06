/**
 * daemon/proxy.ts — Core MCP routing engine.
 *
 * Resolves tool calls to either native handlers or upstream servers,
 * enforces per-profile access control, injects credentials just-in-time,
 * and records audit entries. Based on DESIGN.md Sections 3.2 and 7.4.
 */

import { ToolRegistry } from './tool-registry.js'
import type { CredentialVault } from '../vault/types.js'
import type { IAuditLogger } from '../audit/types.js'
import type { FamConfig, McpServerConfig } from '../config/types.js'
import type { McpResult, ToolDefinition, CallContext } from './types.js'
import { handleNativeTool } from './native-tools.js'
import type { NativeToolDeps } from './native-tools.js'

/**
 * McpUpstreamClient — Interface for upstream MCP connections.
 *
 * Both StdioPool and UpstreamManager implement this interface
 * to allow the proxy to forward tool calls uniformly.
 */
export interface McpUpstreamClient {
  callTool(namespace: string, toolName: string, args: unknown): Promise<McpResult>
  getStatus(): Record<string, { status: string; toolCount: number; lastReachable?: string }>
}

export class McpProxy {
  private startTime: number

  constructor(
    private registry: ToolRegistry,
    private vault: CredentialVault,
    private audit: IAuditLogger,
    private upstreamClients: Map<string, McpUpstreamClient>,
    private config: FamConfig,
  ) {
    this.startTime = Date.now()
  }

  /**
   * Handle a tools/call request.
   *
   * Flow per DESIGN.md Section 3.2:
   * 1. Resolve tool (registry.resolveToolCall)
   * 2. If native -> handleNativeTool
   * 3. Check profile access (is namespace in allowed_servers?)
   * 4. Get credential for server (from config)
   * 5. Pull credential from vault (just-in-time)
   * 6. Forward to upstream client
   * 7. Log to audit
   * 8. Return result
   */
  async handleToolCall(
    profile: string,
    toolName: string,
    args: unknown,
  ): Promise<McpResult> {
    // 1. Resolve the tool
    const resolved = this.registry.resolveToolCall(toolName)
    if (!resolved) {
      return {
        content: [{ type: 'text', text: 'Tool not found.' }],
        isError: true,
      }
    }

    // 2. Native tool handling
    if (resolved.source === 'native') {
      const ctx: CallContext = { profile }
      const deps = this.buildNativeToolDeps(profile)

      const startMs = Date.now()
      const result = await handleNativeTool(resolved.upstreamName, args, ctx, deps)
      const latencyMs = Date.now() - startMs

      this.audit.logCall({
        profile,
        serverNs: 'fam',
        toolName: resolved.upstreamName,
        status: result.isError ? 'error' : 'success',
        latencyMs,
      })

      return result
    }

    // 3. Check profile access — don't leak tool existence
    const profileConfig = this.config.profiles[profile]
    if (!profileConfig) {
      return {
        content: [{ type: 'text', text: 'Tool not found.' }],
        isError: true,
      }
    }

    const { namespace, upstreamName } = resolved
    const isAllowed = profileConfig.allowed_servers.includes(namespace)
    const isDenied = profileConfig.denied_servers?.includes(namespace) ?? false

    if (!isAllowed || isDenied) {
      this.audit.logCall({
        profile,
        serverNs: namespace,
        toolName: upstreamName,
        status: 'denied',
      })
      // Return "Tool not found" to avoid leaking tool existence
      return {
        content: [{ type: 'text', text: 'Tool not found.' }],
        isError: true,
      }
    }

    // 4. Get credential name for this server
    const serverConfig = this.config.mcp_servers[namespace] as McpServerConfig | undefined
    const credentialName = serverConfig?.credential ?? null

    // 5. Pull credential from vault (just-in-time)
    let _credential: string | null = null
    if (credentialName) {
      _credential = await this.vault.get(credentialName)
      if (!_credential) {
        this.audit.logCall({
          profile,
          serverNs: namespace,
          toolName: upstreamName,
          status: 'error',
          errorMsg: `Credential '${credentialName}' not found in keychain`,
        })
        return {
          content: [{
            type: 'text',
            text: 'Server authentication not configured. Contact your administrator.',
          }],
          isError: true,
        }
      }
    }

    // 6. Forward to upstream client
    const client = this.findUpstreamClient(namespace)
    if (!client) {
      this.audit.logCall({
        profile,
        serverNs: namespace,
        toolName: upstreamName,
        status: 'error',
        errorMsg: `No upstream client for namespace '${namespace}'`,
      })
      return {
        content: [{ type: 'text', text: `Server '${namespace}' is not connected.` }],
        isError: true,
      }
    }

    const startMs = Date.now()
    try {
      const result = await client.callTool(namespace, upstreamName, args)
      const latencyMs = Date.now() - startMs

      // 7. Log to audit
      this.audit.logCall({
        profile,
        serverNs: namespace,
        toolName: upstreamName,
        status: result.isError ? 'error' : 'success',
        latencyMs,
      })

      // 8. Return result
      return result
    } catch (err) {
      const latencyMs = Date.now() - startMs
      const errorMsg = err instanceof Error ? err.message : String(err)

      this.audit.logCall({
        profile,
        serverNs: namespace,
        toolName: upstreamName,
        status: 'error',
        latencyMs,
        errorMsg,
      })

      return {
        content: [{ type: 'text', text: `Upstream error: ${errorMsg}` }],
        isError: true,
      }
    }
  }

  /**
   * Handle a tools/list request.
   *
   * Returns only tools allowed by the caller's profile.
   */
  handleToolsList(profile: string): ToolDefinition[] {
    return this.registry.getToolsForProfile(profile)
  }

  /**
   * Update the registry and config after a hot-reload.
   */
  updateRegistry(newRegistry: ToolRegistry, newConfig: FamConfig): void {
    this.registry = newRegistry
    this.config = newConfig
  }

  /**
   * Get tool definitions for a specific namespace (used during reload).
   */
  getToolsForNamespace(namespace: string): ToolDefinition[] {
    return this.registry.getToolsForProfile('').filter(
      (t) => t.name.startsWith(`${namespace}__`),
    )
  }

  /**
   * Find the upstream client that owns a given namespace.
   */
  private findUpstreamClient(namespace: string): McpUpstreamClient | undefined {
    for (const [, client] of this.upstreamClients) {
      const statuses = client.getStatus()
      if (namespace in statuses) {
        return client
      }
    }
    return undefined
  }

  /**
   * Build dependencies for native tool handlers.
   */
  private buildNativeToolDeps(profile: string): NativeToolDeps {
    const allStatuses: Record<string, { status: string; toolCount: number; lastReachable?: string }> = {}
    for (const [, client] of this.upstreamClients) {
      Object.assign(allStatuses, client.getStatus())
    }

    const profileConfig = this.config.profiles[profile]

    return {
      registry: this.registry,
      audit: this.audit,
      startTime: this.startTime,
      serverStatuses: allStatuses,
      profileConfig: profileConfig
        ? {
            allowed_servers: profileConfig.allowed_servers,
            denied_servers: profileConfig.denied_servers ?? [],
          }
        : undefined,
    }
  }
}
