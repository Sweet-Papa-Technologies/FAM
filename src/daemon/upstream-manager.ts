/**
 * daemon/upstream-manager.ts — Manages HTTP/SSE MCP server connections.
 *
 * Creates MCP Client connections to remote HTTP/SSE servers,
 * discovers their tools, and routes tool calls. Handles degraded
 * servers with background retry. Based on DESIGN.md Sections 4.2
 * and 11.1.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { HttpServerConfig, FamConfig } from '../config/types.js'
import type { CredentialVault } from '../vault/types.js'
import type { ToolDefinition, McpResult } from './types.js'
import { FAM_VERSION } from '../utils/version.js'
import logger from '../utils/logger.js'

interface UpstreamEntry {
  client: Client
  transport: SSEClientTransport
  status: 'connecting' | 'healthy' | 'degraded' | 'disconnected'
  toolCount: number
  lastReachable?: string
  retryTimer?: ReturnType<typeof setInterval>
}

const RETRY_INTERVAL_MS = 60_000

export class UpstreamManager {
  private clients: Map<string, UpstreamEntry> = new Map()

  constructor(
    private servers: Record<string, HttpServerConfig>,
    private vault: CredentialVault,
    private config: FamConfig,
  ) {}

  /**
   * Connect to all configured HTTP/SSE servers.
   *
   * For each server: create SSEClientTransport, connect an MCP Client,
   * call tools/list, return discovered tools per namespace.
   * If unreachable: mark degraded, schedule retry every 60s.
   *
   * @returns Map of namespace to discovered tool definitions
   */
  async connect(): Promise<Map<string, ToolDefinition[]>> {
    const discoveredTools = new Map<string, ToolDefinition[]>()

    const connectPromises = Object.entries(this.servers).map(
      async ([namespace, config]) => {
        try {
          const tools = await this.connectServer(namespace, config)
          discoveredTools.set(namespace, tools)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error(
            { namespace, error: errorMsg },
            'Failed to connect to HTTP/SSE server',
          )
          // Mark as degraded and schedule retry
          this.markDegradedWithRetry(namespace, config)
          discoveredTools.set(namespace, [])
        }
      },
    )

    await Promise.all(connectPromises)
    return discoveredTools
  }

  /**
   * Connect to a single HTTP/SSE server and discover its tools.
   */
  private async connectServer(
    namespace: string,
    config: HttpServerConfig,
  ): Promise<ToolDefinition[]> {
    const url = new URL(config.url)

    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1') {
      logger.warn({ namespace, url: config.url }, 'HTTP (not HTTPS) used for non-localhost MCP server — credentials may be exposed in transit')
    }

    // Build request headers if configured
    const requestInit: RequestInit = {}
    if (config.headers) {
      requestInit.headers = { ...config.headers }
    }

    // Inject credential into headers if configured
    if (config.credential) {
      const credValue = await this.vault.get(config.credential)
      if (credValue) {
        const headers = (requestInit.headers ?? {}) as Record<string, string>
        headers['Authorization'] = `Bearer ${credValue}`
        requestInit.headers = headers
      } else {
        logger.warn(
          { namespace, credential: config.credential },
          'Credential not found in vault — connecting without auth',
        )
      }
    }

    const transport = new SSEClientTransport(url, {
      requestInit,
    })

    const client = new Client(
      { name: `fam-http-${namespace}`, version: FAM_VERSION },
      { capabilities: {} },
    )

    transport.onclose = () => {
      const entry = this.clients.get(namespace)
      if (entry && entry.status !== 'disconnected') {
        logger.warn({ namespace }, 'HTTP/SSE connection closed unexpectedly')
        entry.status = 'degraded'
        this.markDegradedWithRetry(namespace, config)
      }
    }

    transport.onerror = (error: Error) => {
      logger.error(
        { namespace, error: error.message },
        'HTTP/SSE transport error',
      )
    }

    await client.connect(transport)

    // Discover tools
    const toolsResult = await client.listTools()
    const tools: ToolDefinition[] = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as object,
    }))

    // Clean up any existing entry for this namespace
    const existing = this.clients.get(namespace)
    if (existing?.retryTimer) {
      clearInterval(existing.retryTimer)
    }

    this.clients.set(namespace, {
      client,
      transport,
      status: 'healthy',
      toolCount: tools.length,
      lastReachable: new Date().toISOString(),
    })

    logger.info(
      { namespace, toolCount: tools.length },
      'HTTP/SSE server connected and tools discovered',
    )

    return tools
  }

  /**
   * Mark a server as degraded and schedule background retry.
   */
  private markDegradedWithRetry(
    namespace: string,
    config: HttpServerConfig,
  ): void {
    const existing = this.clients.get(namespace)
    if (existing?.retryTimer) {
      clearInterval(existing.retryTimer)
    }

    const retryTimer = setInterval(() => {
      logger.info({ namespace }, 'Retrying HTTP/SSE server connection')
      void this.connectServer(namespace, config).catch((err) => {
        logger.debug(
          { namespace, error: err instanceof Error ? err.message : String(err) },
          'Retry failed, will try again',
        )
      })
    }, RETRY_INTERVAL_MS)

    // Don't let retry timer prevent process exit
    if (retryTimer.unref) {
      retryTimer.unref()
    }

    if (existing) {
      existing.status = 'degraded'
      existing.retryTimer = retryTimer
    } else {
      this.clients.set(namespace, {
        client: undefined as unknown as Client,
        transport: undefined as unknown as SSEClientTransport,
        status: 'degraded',
        toolCount: 0,
        retryTimer,
      })
    }
  }

  /**
   * Route a tool call to the correct HTTP/SSE server.
   *
   * @param namespace - Server namespace
   * @param toolName - Upstream tool name (without namespace prefix)
   * @param args - Tool call arguments
   * @param _credential - Optional credential (already injected at connect time)
   * @returns MCP result
   */
  async callTool(
    namespace: string,
    toolName: string,
    args: unknown,
    _credential?: string,
  ): Promise<McpResult> {
    const entry = this.clients.get(namespace)
    if (!entry || entry.status === 'degraded' || entry.status === 'disconnected') {
      return {
        content: [{
          type: 'text',
          text: `Server '${namespace}' is not available (status: ${entry?.status ?? 'not found'})`,
        }],
        isError: true,
      }
    }

    const result = await entry.client.callTool({
      name: toolName,
      arguments: args as Record<string, unknown>,
    })

    // Update last reachable
    entry.lastReachable = new Date().toISOString()

    return {
      content: (result.content as Array<{ type: string; text: string }>) ?? [
        { type: 'text', text: JSON.stringify(result) },
      ],
      isError: result.isError === true ? true : undefined,
    }
  }

  /**
   * Disconnect all HTTP/SSE clients.
   */
  async disconnect(): Promise<void> {
    const disconnectPromises = [...this.clients.entries()].map(
      async ([namespace, entry]) => {
        entry.status = 'disconnected'
        if (entry.retryTimer) {
          clearInterval(entry.retryTimer)
        }
        try {
          await entry.transport?.close?.()
        } catch (err) {
          logger.warn(
            { namespace, error: err instanceof Error ? err.message : String(err) },
            'Error disconnecting HTTP/SSE server',
          )
        }
      },
    )

    await Promise.all(disconnectPromises)
    this.clients.clear()
  }

  /**
   * Get status of all managed HTTP/SSE servers.
   */
  getStatus(): Record<string, { status: string; toolCount: number; lastReachable?: string }> {
    const result: Record<string, { status: string; toolCount: number; lastReachable?: string }> = {}
    for (const [namespace, entry] of this.clients) {
      result[namespace] = {
        status: entry.status,
        toolCount: entry.toolCount,
        lastReachable: entry.lastReachable,
      }
    }
    return result
  }
}
