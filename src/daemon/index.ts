/**
 * daemon/index.ts — Barrel exports for the daemon module.
 *
 * Re-exports all public types, classes, and functions from
 * the daemon module's submodules.
 */

// Types
export type {
  ToolEntry,
  ToolDefinition,
  McpResult,
  CallContext,
  DaemonStatus,
  DaemonDeps,
} from './types.js'

// Auth
export { AuthEngine } from './auth.js'
export type { SessionEntry } from './auth.js'

// Tool Registry
export { ToolRegistry } from './tool-registry.js'

// Native Tools
export {
  getNativeToolDefinitions,
  getNativeToolEntries,
  handleNativeTool,
} from './native-tools.js'
export type { NativeToolDeps } from './native-tools.js'

// Proxy
export { McpProxy } from './proxy.js'
export type { McpUpstreamClient } from './proxy.js'

// Stdio Pool
export { StdioPool } from './stdio-pool.js'

// Upstream Manager
export { UpstreamManager } from './upstream-manager.js'

// Server
export { createDaemon } from './server.js'
export type { ServerDeps } from './server.js'

// Lifecycle
export {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  gracefulShutdown,
} from './lifecycle.js'
