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
import { AuthEngine } from './auth.js'
import type { StdioPool } from './stdio-pool.js'
import type { UpstreamManager } from './upstream-manager.js'
import { ToolRegistry } from './tool-registry.js'
import { getNativeToolEntries } from './native-tools.js'
import { parseConfig } from '../config/parser.js'
import type { SessionStore } from '../config/types.js'
import { readFileSync, existsSync } from 'node:fs'
import { SESSIONS_FILE } from '../utils/paths.js'
import type { KnowledgeStore } from '../knowledge/index.js'
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
  configPath?: string
  knowledgeStore?: KnowledgeStore
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
    bodyLimit: 1_048_576, // 1MB max request body
  })

  const { proxy, auth } = deps

  // ─── Simple per-profile rate limiter ──────────────────────────
  const rateLimits = new Map<string, { count: number; resetAt: number }>()
  const RATE_LIMIT_MAX = 200       // max calls per window
  const RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute

  function checkRateLimit(profile: string): boolean {
    const now = Date.now()
    const entry = rateLimits.get(profile)
    if (!entry || now > entry.resetAt) {
      rateLimits.set(profile, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
      return true
    }
    if (entry.count >= RATE_LIMIT_MAX) return false
    entry.count++
    return true
  }

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

    // 1b. Rate limit check
    if (!checkRateLimit(profile)) {
      return reply.status(429).send({
        jsonrpc: '2.0',
        id: (request.body as JsonRpcRequest)?.id ?? null,
        error: { code: -32000, message: 'Rate limit exceeded. Try again later.' },
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
              version: '1.0.0',
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

  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization
    const profile = auth.resolveProfile(authHeader)

    const uptimeMs = Date.now() - deps.startTime

    if (!profile) {
      // Unauthenticated: minimal response
      return reply.status(200).send({
        status: 'ok',
        version: '1.0.0',
      })
    }

    // Authenticated: full details
    const stdioStatus = deps.stdioPool.getStatus()
    const httpStatus = deps.upstreamManager.getStatus()
    const allServers = { ...stdioStatus, ...httpStatus }

    const allHealthy = Object.values(allServers).every(
      (s) => s.status === 'healthy',
    )

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      uptime_ms: uptimeMs,
      version: '1.0.0',
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

    logger.info('Config reload requested')

    try {
      // 1. Re-parse fam.yaml
      const configPath = deps.configPath
      if (!configPath) {
        return reply.status(200).send({
          success: false,
          message: 'No config path available for reload.',
        })
      }

      const newConfig = parseConfig(configPath)

      // 2. Rebuild tool registry with current upstream tools
      const newRegistry = new ToolRegistry()

      // Re-register tools from existing pools (tools already discovered)
      const stdioStatus = deps.stdioPool.getStatus()
      const httpStatus = deps.upstreamManager.getStatus()

      // We can't re-discover tools without reconnecting, but we can rebuild
      // profile views from the new config. For tools, copy from current proxy.
      const currentTools = proxy.handleToolsList('')  // empty profile = get all for rebuild
      // Actually, re-use the existing registry's tools and just rebuild profile views
      for (const [ns, info] of Object.entries({ ...stdioStatus, ...httpStatus })) {
        // Re-register existing upstream tools by querying current registry
        const tools = deps.proxy.getToolsForNamespace(ns)
        if (tools.length > 0) {
          newRegistry.registerUpstreamTools(ns, tools)
        }
      }
      newRegistry.registerNativeTools(getNativeToolEntries())

      // 3. Rebuild per-profile filtered views from new config
      const profileViews: Record<string, { allowed_servers: string[]; denied_servers?: string[] }> = {}
      for (const [name, profile] of Object.entries(newConfig.profiles)) {
        profileViews[name] = {
          allowed_servers: profile.allowed_servers,
          denied_servers: profile.denied_servers,
        }
      }
      newRegistry.buildProfileViews(profileViews)

      // 4. Reload sessions
      let sessionsData: SessionStore = { tokens: {} }
      try {
        if (existsSync(SESSIONS_FILE)) {
          sessionsData = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as SessionStore
        }
      } catch {
        // Keep empty sessions
      }

      // Update auth engine and proxy's registry
      const newAuth = new AuthEngine(sessionsData)
      deps.proxy.updateRegistry(newRegistry, newConfig)
      deps.auth = newAuth
      // Update the auth reference used by the /mcp route
      Object.assign(proxy, { registry: newRegistry })

      const changes = [
        `${Object.keys(newConfig.profiles).length} profiles`,
        `${Object.keys(newConfig.mcp_servers).length} servers`,
      ]

      logger.info({ changes }, 'Config reloaded successfully')

      return reply.status(200).send({
        success: true,
        message: 'Config reloaded.',
        changes,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ error: msg }, 'Config reload failed')
      return reply.status(200).send({
        success: false,
        message: `Reload failed: ${msg}`,
      })
    }
  })

  return app
}
