/**
 * test/mocks/mcp-server.ts — Mock upstream MCP client for testing.
 *
 * Simulates an upstream MCP server connection that can respond
 * to tools/list and tools/call requests without real network
 * or process connections.
 */

import type { ToolDefinition, McpResult } from '../../src/daemon/types.js'
import type { McpUpstreamClient } from '../../src/daemon/proxy.js'

/**
 * MockUpstreamClient — In-memory mock for upstream MCP servers.
 *
 * Tracks which namespaces it owns and responds to tool calls
 * with configurable results.
 */
export class MockUpstreamClient implements McpUpstreamClient {
  private tools: Map<string, ToolDefinition[]> = new Map()
  private callResults: Map<string, McpResult> = new Map()
  private callLog: Array<{ namespace: string; toolName: string; args: unknown }> = []
  private statuses: Record<string, { status: string; toolCount: number; lastReachable?: string }> = {}

  constructor(tools?: Record<string, ToolDefinition[]>) {
    if (tools) {
      for (const [namespace, defs] of Object.entries(tools)) {
        this.tools.set(namespace, defs)
        this.statuses[namespace] = {
          status: 'healthy',
          toolCount: defs.length,
          lastReachable: new Date().toISOString(),
        }
      }
    }
  }

  /**
   * Register tools for a namespace.
   */
  addNamespace(namespace: string, tools: ToolDefinition[]): void {
    this.tools.set(namespace, tools)
    this.statuses[namespace] = {
      status: 'healthy',
      toolCount: tools.length,
      lastReachable: new Date().toISOString(),
    }
  }

  /**
   * Configure a specific result for a tool call.
   */
  setCallResult(namespace: string, toolName: string, result: McpResult): void {
    this.callResults.set(`${namespace}__${toolName}`, result)
  }

  /**
   * Set the status for a namespace.
   */
  setStatus(namespace: string, status: string): void {
    if (this.statuses[namespace]) {
      this.statuses[namespace].status = status
    }
  }

  /**
   * List tools for a namespace.
   */
  listTools(namespace: string): ToolDefinition[] {
    return this.tools.get(namespace) ?? []
  }

  /**
   * Call a tool on the upstream server.
   */
  async callTool(
    namespace: string,
    toolName: string,
    args: unknown,
  ): Promise<McpResult> {
    this.callLog.push({ namespace, toolName, args })

    const key = `${namespace}__${toolName}`
    const configured = this.callResults.get(key)
    if (configured) {
      return configured
    }

    // Default success response
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            mock: true,
            namespace,
            toolName,
            args,
          }),
        },
      ],
    }
  }

  /**
   * Get status of all managed namespaces.
   */
  getStatus(): Record<string, { status: string; toolCount: number; lastReachable?: string }> {
    return { ...this.statuses }
  }

  /**
   * Get the log of all tool calls made to this mock.
   */
  getCallLog(): Array<{ namespace: string; toolName: string; args: unknown }> {
    return [...this.callLog]
  }

  /**
   * Clear the call log.
   */
  clearCallLog(): void {
    this.callLog = []
  }
}

/**
 * MockAuditLogger — Minimal audit logger mock for testing.
 */
export class MockAuditLogger {
  private calls: Array<Record<string, unknown>> = []
  private changes: Array<Record<string, unknown>> = []

  async init(): Promise<void> {
    // no-op
  }

  logCall(entry: Record<string, unknown>): void {
    this.calls.push(entry)
  }

  logConfigChange(entry: Record<string, unknown>): void {
    this.changes.push(entry)
  }

  query(): Array<Record<string, unknown>> {
    return this.calls
  }

  export(): string {
    return JSON.stringify({ calls: this.calls, changes: this.changes })
  }

  close(): void {
    // no-op
  }

  /** Test helper — get all logged calls. */
  getCalls(): Array<Record<string, unknown>> {
    return [...this.calls]
  }

  /** Test helper — get all logged config changes. */
  getChanges(): Array<Record<string, unknown>> {
    return [...this.changes]
  }

  /** Test helper — clear all logs. */
  clear(): void {
    this.calls = []
    this.changes = []
  }
}
