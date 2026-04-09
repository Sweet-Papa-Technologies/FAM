/**
 * daemon/stdio-pool.ts — Manages stdio MCP server child processes.
 *
 * Spawns, supervises, and routes tool calls to stdio-based MCP
 * servers. Implements auto-restart with circuit breaker (max 3
 * failures in 60s). Based on DESIGN.md Sections 4.2 and 11.1.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StdioServerConfig } from '../config/types.js'
import type { ToolDefinition, McpResult } from './types.js'
import { FAM_VERSION } from '../utils/version.js'
import logger from '../utils/logger.js'

interface StdioProcessEntry {
  transport: StdioClientTransport
  client: Client
  failures: number
  failureTimestamps: number[]
  status: 'connecting' | 'healthy' | 'degraded' | 'stopped'
  toolCount: number
}

const MAX_FAILURES = 3
const FAILURE_WINDOW_MS = 60_000
const SHUTDOWN_TIMEOUT_MS = 3_000

export class StdioPool {
  private processes: Map<string, StdioProcessEntry> = new Map()

  constructor(private servers: Record<string, StdioServerConfig>) {}

  /**
   * Start all configured stdio servers.
   *
   * For each server: spawn child process, create StdioClientTransport,
   * connect an MCP Client, call tools/list, return discovered tools
   * per namespace. Failures are handled gracefully (degraded, not crash).
   *
   * @returns Map of namespace to discovered tool definitions
   */
  async start(): Promise<Map<string, ToolDefinition[]>> {
    const discoveredTools = new Map<string, ToolDefinition[]>()

    const startPromises = Object.entries(this.servers).map(
      async ([namespace, config]) => {
        try {
          const tools = await this.spawnAndDiscover(namespace, config)
          discoveredTools.set(namespace, tools)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error(
            { namespace, error: errorMsg },
            'Failed to start stdio server',
          )
          // Mark as degraded but don't crash the pool
          this.processes.set(namespace, {
            transport: undefined as unknown as StdioClientTransport,
            client: undefined as unknown as Client,
            failures: 1,
            failureTimestamps: [Date.now()],
            status: 'degraded',
            toolCount: 0,
          })
          discoveredTools.set(namespace, [])
        }
      },
    )

    await Promise.all(startPromises)
    return discoveredTools
  }

  /**
   * Spawn a single stdio server and discover its tools.
   */
  private async spawnAndDiscover(
    namespace: string,
    config: StdioServerConfig,
  ): Promise<ToolDefinition[]> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
        ? { ...process.env, ...config.env } as Record<string, string>
        : undefined,
      stderr: 'pipe',
    })

    const client = new Client(
      { name: `fam-stdio-${namespace}`, version: FAM_VERSION },
      { capabilities: {} },
    )

    // Set up crash detection for auto-restart
    transport.onclose = () => {
      const entry = this.processes.get(namespace)
      if (entry && entry.status !== 'stopped') {
        logger.warn({ namespace }, 'Stdio server process exited unexpectedly')
        this.handleProcessCrash(namespace, config)
      }
    }

    transport.onerror = (error: Error) => {
      logger.error(
        { namespace, error: error.message },
        'Stdio transport error',
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

    this.processes.set(namespace, {
      transport,
      client,
      failures: 0,
      failureTimestamps: [],
      status: 'healthy',
      toolCount: tools.length,
    })

    logger.info(
      { namespace, toolCount: tools.length },
      'Stdio server connected and tools discovered',
    )

    return tools
  }

  /**
   * Handle a process crash with circuit breaker logic.
   *
   * Auto-restart unless 3+ failures in 60 seconds, then mark degraded.
   */
  private handleProcessCrash(
    namespace: string,
    config: StdioServerConfig,
  ): void {
    const entry = this.processes.get(namespace)
    if (!entry) return

    const now = Date.now()
    entry.failureTimestamps.push(now)

    // Prune old failure timestamps
    entry.failureTimestamps = entry.failureTimestamps.filter(
      (ts) => now - ts < FAILURE_WINDOW_MS,
    )

    entry.failures = entry.failureTimestamps.length

    if (entry.failures >= MAX_FAILURES) {
      entry.status = 'degraded'
      logger.error(
        { namespace, failures: entry.failures },
        'Stdio server marked degraded — too many crashes',
      )
      return
    }

    // Auto-restart
    logger.info({ namespace }, 'Auto-restarting stdio server')
    entry.status = 'connecting'

    void this.spawnAndDiscover(namespace, config).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(
        { namespace, error: errorMsg },
        'Failed to restart stdio server',
      )
      const current = this.processes.get(namespace)
      if (current) {
        current.status = 'degraded'
      }
    })
  }

  /**
   * Route a tool call to the correct stdio server.
   *
   * @param namespace - Server namespace
   * @param toolName - Upstream tool name (without namespace prefix)
   * @param args - Tool call arguments
   * @returns MCP result
   */
  async callTool(
    namespace: string,
    toolName: string,
    args: unknown,
  ): Promise<McpResult> {
    const entry = this.processes.get(namespace)
    if (!entry || entry.status === 'degraded' || entry.status === 'stopped') {
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

    return {
      content: (result.content as Array<{ type: string; text: string }>) ?? [
        { type: 'text', text: JSON.stringify(result) },
      ],
      isError: result.isError === true ? true : undefined,
    }
  }

  /**
   * Gracefully stop all child processes.
   *
   * Sends close to each transport. Falls back to SIGKILL after 3s.
   */
  async stop(): Promise<void> {
    const stopPromises = [...this.processes.entries()].map(
      async ([namespace, entry]) => {
        entry.status = 'stopped'
        try {
          // Give the transport time to close gracefully
          const closePromise = entry.transport?.close?.()
          if (closePromise) {
            await Promise.race([
              closePromise,
              new Promise<void>((resolve) =>
                setTimeout(resolve, SHUTDOWN_TIMEOUT_MS),
              ),
            ])
          }
        } catch (err) {
          logger.warn(
            { namespace, error: err instanceof Error ? err.message : String(err) },
            'Error stopping stdio server',
          )
        }
      },
    )

    await Promise.all(stopPromises)
    this.processes.clear()
  }

  /**
   * Get status of all managed stdio servers.
   */
  getStatus(): Record<string, { status: string; toolCount: number }> {
    const result: Record<string, { status: string; toolCount: number }> = {}
    for (const [namespace, entry] of this.processes) {
      result[namespace] = {
        status: entry.status,
        toolCount: entry.toolCount,
      }
    }
    return result
  }
}
