/**
 * daemon/server.ts — Fastify server setup for the FAM daemon.
 *
 * Creates the HTTP server with MCP JSON-RPC endpoint, health check,
 * and hot-reload. The MCP endpoint handles tools/list and tools/call
 * via JSON-RPC 2.0 protocol. Based on DESIGN.md Sections 7.1 and 11.1.
 */

import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { FamConfig } from '../config/types.js'
import type { DaemonDeps } from './types.js'
import type { McpProxy } from './proxy.js'
import type { AuthEngine } from './auth.js'
import type { StdioPool } from './stdio-pool.js'
import type { UpstreamManager } from './upstream-manager.js'
import logger from '../utils/logger.js'

/**
 * Extended DaemonDeps with runtime components needed by the server.
 */
export interface ServerDeps extends DaemonDeps {
  proxy: McpProxy
  auth: AuthEngine
  stdioPool: StdioPool
  upstreamManager: UpstreamManager
  startTime: number
}

/**
 * JSON-RPC 2.0 request body shape.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

/**
 * Create the Fastify daemon server.
 *
 * Registers routes:
 *   POST /mcp       — MCP JSON-RPC endpoint
 *   GET  /health    — JSON health check
 *   POST /api/v1/reload — hot-reload config (localhost only)
 *
 * For MVP: implements MCP as a JSON-RPC endpoint that handles
 * tools/list and tools/call manually. Full MCP SDK server transport
 * integration can be refined in v1.
 */
export async function createDaemon(
  config: FamConfig,
  deps: ServerDeps,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino logger
  })

  const { proxy, auth } = deps

  // ─── POST /mcp — MCP JSON-RPC endpoint ────────────────────────

  app.post('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Authenticate
    const authHeader = request.headers.authorization
    const queryToken = (request.query as Record<string, string | undefined>)?.token
    const profile = auth.resolveProfile(authHeader) ?? auth.resolveProfileFromQuery(queryToken)

    if (!profile) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: (request.body as JsonRpcRequest)?.id ?? null,
        error: {
          code: -32000,
          message: 'Invalid or missing authentication token.',
        },
      })
    }

    // 2. Parse JSON-RPC request
    const body = request.body as JsonRpcRequest
    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC request.',
        },
      })
    }

    // 3. Route based on method
    switch (body.method) {
      case 'tools/list': {
        const tools = proxy.handleToolsList(profile)
        return reply.status(200).send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          result: { tools },
        })
      }

      case 'tools/call': {
        const params = body.params ?? {}
        const toolName = params.name as string | undefined
        const toolArgs = params.arguments ?? {}

        if (!toolName) {
          return reply.status(200).send({
            jsonrpc: '2.0',
            id: body.id ?? null,
            error: {
              code: -32602,
              message: 'Missing required parameter: name',
            },
          })
        }

        const result = await proxy.handleToolCall(profile, toolName, toolArgs)
        return reply.status(200).send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          result,
        })
      }

      case 'initialize': {
        // Basic MCP initialization response
        return reply.status(200).send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: 'fam',
              version: '0.1.0',
            },
          },
        })
      }

      default: {
        return reply.status(200).send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: {
            code: -32601,
            message: `Method not found: ${body.method}`,
          },
        })
      }
    }
  })

  // ─── GET /health — Health check endpoint ──────────────────────

  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const uptimeMs = Date.now() - deps.startTime

    const stdioStatus = deps.stdioPool.getStatus()
    const httpStatus = deps.upstreamManager.getStatus()
    const allServers = { ...stdioStatus, ...httpStatus }

    const allHealthy = Object.values(allServers).every(
      (s) => s.status === 'healthy',
    )

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      uptime_ms: uptimeMs,
      version: '0.1.0',
      servers: allServers,
      profiles: auth.getProfiles(),
      tool_count: proxy.handleToolsList(auth.getProfiles()[0] ?? '').length,
    })
  })

  // ─── POST /api/v1/reload — Hot reload endpoint ────────────────

  app.post('/api/v1/reload', async (request: FastifyRequest, reply: FastifyReply) => {
    // Localhost-only check
    const remoteAddr = request.ip
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      return reply.status(403).send({
        error: 'Reload is only available from localhost.',
      })
    }

    // In a full implementation, this would:
    // 1. Re-parse fam.yaml
    // 2. Validate schema
    // 3. Diff against running config
    // 4. Apply changes
    // For MVP, return success acknowledgment
    logger.info('Config reload requested')

    return reply.status(200).send({
      success: true,
      message: 'Config reload requested. Full implementation in v1.',
    })
  })

  return app
}
