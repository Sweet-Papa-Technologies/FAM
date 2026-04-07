/**
 * test/unit/daemon/native-tools.test.ts — Native tool handler tests.
 *
 * Tests fam__whoami, fam__log_action, fam__list_servers, fam__health.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  handleNativeTool,
  getNativeToolDefinitions,
  getNativeToolEntries,
} from '../../../src/daemon/native-tools.js'
import type { NativeToolDeps } from '../../../src/daemon/native-tools.js'
import type { CallContext } from '../../../src/daemon/types.js'
import { ToolRegistry } from '../../../src/daemon/tool-registry.js'
import { MockAuditLogger } from '../../mocks/mcp-server.js'

describe('Native Tools', () => {
  let registry: ToolRegistry
  let audit: MockAuditLogger
  let deps: NativeToolDeps
  let ctx: CallContext

  beforeEach(() => {
    registry = new ToolRegistry()
    audit = new MockAuditLogger()

    // Register some upstream tools for context
    registry.registerUpstreamTools('github', [
      { name: 'repos_list', description: 'List repos', inputSchema: { type: 'object', properties: {} } },
      { name: 'issues_create', description: 'Create issue', inputSchema: { type: 'object', properties: {} } },
    ])
    registry.registerUpstreamTools('jira', [
      { name: 'issues_search', description: 'Search issues', inputSchema: { type: 'object', properties: {} } },
    ])
    registry.registerNativeTools(getNativeToolEntries())
    registry.buildProfileViews({
      'claude-code': {
        allowed_servers: ['github'],
        denied_servers: ['jira'],
      },
    })

    deps = {
      registry,
      audit: audit as unknown as NativeToolDeps['audit'],
      startTime: Date.now() - 86400_000, // 24 hours ago
      serverStatuses: {
        github: { status: 'healthy', toolCount: 2, lastReachable: '2026-04-06T14:29:55Z' },
        jira: { status: 'degraded', toolCount: 1, lastReachable: '2026-04-06T12:00:00Z' },
      },
      profileConfig: {
        allowed_servers: ['github'],
        denied_servers: ['jira'],
      },
    }

    ctx = { profile: 'claude-code' }
  })

  describe('getNativeToolDefinitions', () => {
    it('should return 9 native tool definitions', () => {
      const defs = getNativeToolDefinitions()
      expect(defs).toHaveLength(9)
    })

    it('should include all expected tools', () => {
      const defs = getNativeToolDefinitions()
      const names = defs.map((d) => d.name)
      expect(names).toContain('fam__whoami')
      expect(names).toContain('fam__log_action')
      expect(names).toContain('fam__list_servers')
      expect(names).toContain('fam__health')
      expect(names).toContain('fam__get_knowledge')
      expect(names).toContain('fam__set_knowledge')
      expect(names).toContain('fam__search_knowledge')
      expect(names).toContain('fam__get_audit_log')
      expect(names).toContain('fam__list_profiles')
    })

    it('should have valid inputSchema on all tools', () => {
      const defs = getNativeToolDefinitions()
      for (const def of defs) {
        expect(def.inputSchema).toBeDefined()
        expect((def.inputSchema as Record<string, unknown>).type).toBe('object')
      }
    })
  })

  describe('getNativeToolEntries', () => {
    it('should return ToolEntry objects with fam namespace', () => {
      const entries = getNativeToolEntries()
      for (const entry of entries) {
        expect(entry.namespace).toBe('fam')
        expect(entry.source).toBe('native')
        expect(entry.namespacedName).toMatch(/^fam__/)
      }
    })
  })

  describe('handleNativeTool — whoami', () => {
    it('should return profile info', async () => {
      const result = await handleNativeTool('whoami', {}, ctx, deps)

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)

      expect(data.profile).toBe('claude-code')
      expect(data.allowed_servers).toEqual(['github'])
      expect(data.denied_servers).toEqual(['jira'])
      expect(data.tool_count).toBeGreaterThan(0)
      expect(data.native_tools).toContain('fam__whoami')
      expect(data.native_tools).toContain('fam__get_knowledge')
      expect(data.native_tools).toContain('fam__set_knowledge')
      expect(data.native_tools).toContain('fam__search_knowledge')
      expect(data.native_tools).toContain('fam__get_audit_log')
      expect(data.native_tools).toContain('fam__list_profiles')
      expect(data.native_tools).toHaveLength(9)
    })
  })

  describe('handleNativeTool — log_action', () => {
    it('should log action and return { logged: true }', async () => {
      const result = await handleNativeTool(
        'log_action',
        { action: 'file_edit', description: 'Edited README.md' },
        ctx,
        deps,
      )

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.logged).toBe(true)

      // Verify audit logger was called
      const changes = audit.getChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].action).toBe('agent_report')
      expect(changes[0].target).toBe('claude-code')
    })

    it('should return error for missing action', async () => {
      const result = await handleNativeTool(
        'log_action',
        { description: 'Something happened' },
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('action')
    })

    it('should return error for missing description', async () => {
      const result = await handleNativeTool(
        'log_action',
        { action: 'test' },
        ctx,
        deps,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('description')
    })

    it('should return error for null args', async () => {
      const result = await handleNativeTool('log_action', null, ctx, deps)
      expect(result.isError).toBe(true)
    })

    it('should return error for non-object args', async () => {
      const result = await handleNativeTool('log_action', 'string', ctx, deps)
      expect(result.isError).toBe(true)
    })

    it('should include metadata in audit entry', async () => {
      await handleNativeTool(
        'log_action',
        {
          action: 'deploy',
          description: 'Deployed to staging',
          metadata: { env: 'staging', commit: 'abc123' },
        },
        ctx,
        deps,
      )

      const changes = audit.getChanges()
      expect(changes).toHaveLength(1)
      const details = JSON.parse(changes[0].details as string)
      expect(details.metadata).toEqual({ env: 'staging', commit: 'abc123' })
    })
  })

  describe('handleNativeTool — list_servers', () => {
    it('should return server info for the profile', async () => {
      const result = await handleNativeTool('list_servers', {}, ctx, deps)

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)

      expect(data.servers).toBeDefined()
      expect(Array.isArray(data.servers)).toBe(true)

      // Claude-code should see github (allowed) but not jira (denied)
      const serverNames = data.servers.map((s: Record<string, unknown>) => s.name)
      expect(serverNames).toContain('github')
    })
  })

  describe('handleNativeTool — health', () => {
    it('should return daemon status', async () => {
      const result = await handleNativeTool('health', {}, ctx, deps)

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)

      expect(data.daemon).toBeDefined()
      expect(data.daemon.status).toBe('healthy')
      expect(data.daemon.version).toBe('1.0.0')
      expect(data.daemon.uptime_seconds).toBeGreaterThan(0)
    })

    it('should include server statuses', async () => {
      const result = await handleNativeTool('health', {}, ctx, deps)
      const data = JSON.parse(result.content[0].text)

      expect(data.servers.github).toBeDefined()
      expect(data.servers.github.status).toBe('healthy')
      expect(data.servers.jira.status).toBe('degraded')
    })
  })

  describe('handleNativeTool — unknown tool', () => {
    it('should return error for unknown native tool', async () => {
      const result = await handleNativeTool('nonexistent', {}, ctx, deps)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown native tool')
    })
  })
})
