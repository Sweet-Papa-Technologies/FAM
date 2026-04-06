/**
 * daemon/lifecycle.ts — Daemon process management.
 *
 * Manages PID files, startup sequence, graceful shutdown, and
 * status checks. Based on DESIGN.md Section 11.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { FamConfig } from '../config/types.js'
import type { SessionStore } from '../config/types.js'
import type { IAuditLogger } from '../audit/types.js'
import type { CredentialVault } from '../vault/types.js'
import type { DaemonStatus } from './types.js'
import { PID_FILE, SESSIONS_FILE } from '../utils/paths.js'
import { DaemonError } from '../utils/errors.js'
import { ToolRegistry } from './tool-registry.js'
import { AuthEngine } from './auth.js'
import { McpProxy } from './proxy.js'
import type { McpUpstreamClient } from './proxy.js'
import { StdioPool } from './stdio-pool.js'
import { UpstreamManager } from './upstream-manager.js'
import { getNativeToolEntries } from './native-tools.js'
import { createDaemon } from './server.js'
import type { StdioServerConfig, HttpServerConfig } from '../config/types.js'
import logger from '../utils/logger.js'

const SHUTDOWN_DRAIN_MS = 5_000

/**
 * Start the FAM daemon.
 *
 * Startup sequence per DESIGN.md Section 11.1:
 * 1. Check for existing PID file (stale -> remove, alive -> exit)
 * 2. Validate config
 * 3. Create all dependencies (vault, audit, auth, registry)
 * 4. Start stdio pool + upstream manager
 * 5. Build tool registry
 * 6. Create + start Fastify server
 * 7. Write PID file
 * 8. Register signal handlers
 */
export async function startDaemon(
  config: FamConfig,
  options: { foreground?: boolean },
  deps: {
    vault: CredentialVault
    audit: IAuditLogger
    configPath?: string
  },
): Promise<void> {
  const startTime = Date.now()

  // 1. Check for existing PID file
  if (existsSync(PID_FILE)) {
    const pidContent = readFileSync(PID_FILE, 'utf-8').trim()
    const existingPid = parseInt(pidContent, 10)

    if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
      throw new DaemonError(
        'DAEMON_ALREADY_RUNNING',
        `Daemon is already running (PID ${existingPid}). Use 'fam daemon stop' first.`,
      )
    }

    // Stale PID file — remove it
    logger.warn({ pid: existingPid }, 'Removed stale PID file')
    unlinkSync(PID_FILE)
  }

  // 2. Config is already validated by caller

  // 3. Create dependencies
  const { vault, audit } = deps

  // Load sessions
  let sessionsData: SessionStore = { tokens: {} }
  try {
    if (existsSync(SESSIONS_FILE)) {
      const raw = readFileSync(SESSIONS_FILE, 'utf-8')
      sessionsData = JSON.parse(raw) as SessionStore
    }
  } catch {
    logger.warn('Failed to load sessions.json — starting with empty sessions')
  }

  const auth = new AuthEngine(sessionsData)
  const registry = new ToolRegistry()

  // 4. Start upstream connections
  // Separate stdio and HTTP servers
  const stdioServers: Record<string, StdioServerConfig> = {}
  const httpServers: Record<string, HttpServerConfig> = {}

  for (const [name, server] of Object.entries(config.mcp_servers)) {
    if (server.transport === 'stdio') {
      stdioServers[name] = server as StdioServerConfig
    } else {
      httpServers[name] = server as HttpServerConfig
    }
  }

  const stdioPool = new StdioPool(stdioServers)
  const upstreamManager = new UpstreamManager(httpServers, vault, config)

  const [stdioTools, httpTools] = await Promise.all([
    stdioPool.start(),
    upstreamManager.connect(),
  ])

  // 5. Build tool registry
  for (const [namespace, tools] of stdioTools) {
    registry.registerUpstreamTools(namespace, tools)
  }
  for (const [namespace, tools] of httpTools) {
    registry.registerUpstreamTools(namespace, tools)
  }

  // Register native tools
  registry.registerNativeTools(getNativeToolEntries())

  // Build per-profile filtered views
  const profileViews: Record<string, { allowed_servers: string[]; denied_servers?: string[] }> = {}
  for (const [name, profile] of Object.entries(config.profiles)) {
    profileViews[name] = {
      allowed_servers: profile.allowed_servers,
      denied_servers: profile.denied_servers,
    }
  }
  registry.buildProfileViews(profileViews)

  // Create upstream client map for proxy
  const upstreamClients = new Map<string, McpUpstreamClient>()
  upstreamClients.set('stdio', stdioPool)
  upstreamClients.set('http', upstreamManager)

  // Create proxy
  const proxy = new McpProxy(registry, vault, audit, upstreamClients, config)

  // 6. Create + start Fastify server
  const server = await createDaemon(config, {
    config,
    vault,
    audit,
    proxy,
    auth,
    stdioPool,
    upstreamManager,
    startTime,
    configPath: deps.configPath,
  })

  const port = config.settings.daemon.port
  await server.listen({ port, host: '127.0.0.1' })

  // 7. Write PID file
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')

  // 8. Register signal handlers
  const shutdown = async () => {
    logger.info('Shutting down daemon...')
    await gracefulShutdown(server, stdioPool, upstreamManager, audit)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  const totalTools = registry.getToolCount()
  const profileCount = Object.keys(config.profiles).length
  const serverCount = Object.keys(config.mcp_servers).length

  logger.info(
    { port, pid: process.pid, servers: serverCount, tools: totalTools, profiles: profileCount },
    `FAM daemon started — ${serverCount} servers, ${totalTools} tools, ${profileCount} profiles`,
  )

  if (options.foreground) {
    // Stay attached — process will run until signal received
    logger.info('Running in foreground mode. Press Ctrl+C to stop.')
  }
}

/**
 * Stop the running daemon.
 *
 * Read PID file, send SIGTERM, wait up to 5s, SIGKILL if needed,
 * remove PID file.
 */
export async function stopDaemon(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    throw new DaemonError('DAEMON_NOT_RUNNING', 'No PID file found. Daemon is not running.')
  }

  const pidContent = readFileSync(PID_FILE, 'utf-8').trim()
  const pid = parseInt(pidContent, 10)

  if (isNaN(pid)) {
    unlinkSync(PID_FILE)
    throw new DaemonError('INVALID_PID', 'PID file contains invalid data. Removed.')
  }

  if (!isProcessAlive(pid)) {
    unlinkSync(PID_FILE)
    logger.warn({ pid }, 'Daemon was not running. Removed stale PID file.')
    return
  }

  // Send SIGTERM
  process.kill(pid, 'SIGTERM')
  logger.info({ pid }, 'Sent SIGTERM to daemon')

  // Wait up to 5s for graceful shutdown
  const deadline = Date.now() + SHUTDOWN_DRAIN_MS
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await sleep(200)
  }

  // SIGKILL if still alive
  if (isProcessAlive(pid)) {
    logger.warn({ pid }, 'Daemon did not stop gracefully — sending SIGKILL')
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already dead
    }
  }

  // Clean up PID file
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }

  logger.info({ pid }, 'Daemon stopped')
}

/**
 * Get the current daemon status.
 *
 * @returns DaemonStatus or null if not running
 */
export function getDaemonStatus(): DaemonStatus | null {
  if (!existsSync(PID_FILE)) {
    return null
  }

  const pidContent = readFileSync(PID_FILE, 'utf-8').trim()
  const pid = parseInt(pidContent, 10)

  if (isNaN(pid) || !isProcessAlive(pid)) {
    return { running: false }
  }

  return {
    running: true,
    pid,
  }
}

/**
 * Perform graceful shutdown of all daemon components.
 *
 * Per DESIGN.md Section 11.2:
 * 1. Stop accepting connections
 * 2. Drain in-flight calls (5s timeout)
 * 3. Stop stdio pool + upstream manager
 * 4. Close audit DB
 * 5. Remove PID file
 * 6. Exit
 */
export async function gracefulShutdown(
  server: FastifyInstance,
  stdioPool: StdioPool,
  upstreamManager: UpstreamManager,
  audit: IAuditLogger,
): Promise<void> {
  try {
    // 1. Stop accepting + drain (Fastify handles this)
    await Promise.race([
      server.close(),
      sleep(SHUTDOWN_DRAIN_MS),
    ])
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Error closing Fastify server',
    )
  }

  // 3. Stop upstream connections
  await Promise.all([
    stdioPool.stop(),
    upstreamManager.disconnect(),
  ])

  // 4. Close audit DB
  try {
    audit.close()
  } catch {
    // Best effort
  }

  // 5. Remove PID file
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE)
    } catch {
      // Best effort
    }
  }

  logger.info('Graceful shutdown complete')
}

// ─── Helpers ────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 checks if process exists without killing it
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
