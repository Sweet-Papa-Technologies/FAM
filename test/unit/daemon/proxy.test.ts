/**
 * test/unit/daemon/proxy.test.ts — McpProxy unit tests.
 *
 * Tests tool routing, access control, credential injection,
 * audit logging, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { McpProxy } from '../../../src/daemon/proxy.js'
import { ToolRegistry } from '../../../src/daemon/tool-registry.js'
import { getNativeToolEntries } from '../../../src/daemon/native-tools.js'
import { MockUpstreamClient, MockAuditLogger } from '../../mocks/mcp-server.js'
import { InMemoryVault } from '../../mocks/keychain.js'
import type { FamConfig, ProfileConfig, McpServerConfig } from '../../../src/config/types.js'

function createMinimalConfig(overrides?: Partial<FamConfig>): FamConfig {
  return {
    version: '0.1',
    settings: {
      daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    credentials: {
      'github-pat': { type: 'api_key', description: 'GitHub PAT' },
    },
    mcp_servers: {
      github: {
        url: 'https://api.github.com/mcp',
        transport: 'sse',
        credential: 'github-pat',
        description: 'GitHub',
      } as McpServerConfig,
      jira: {
        url: 'https://jira.example.com/mcp',
        transport: 'sse',
        credential: null,
        description: 'Jira',
      } as McpServerConfig,
    },
    profiles: {
      'claude-code': {
        description: 'Claude Code',
        config_target: 'claude_code',
        allowed_servers: ['github'],
        denied_servers: ['jira'],
      } as ProfileConfig,
      cursor: {
        description: 'Cursor',
        config_target: 'cursor',
        allowed_servers: ['github', 'jira'],
        denied_servers: [],
      } as ProfileConfig,
    },
    generators: {},
    native_tools: {},
    instructions: { enabled: false, output_dir: '~/.fam/instructions/' },
    ...overrides,
  }
}

describe('McpProxy', () => {
  let proxy: McpProxy
  let registry: ToolRegistry
  let vault: InMemoryVault
  let audit: MockAuditLogger
  let mockClient: MockUpstreamClient
  let config: FamConfig

  beforeEach(async () => {
    registry = new ToolRegistry()
    vault = new InMemoryVault()
    audit = new MockAuditLogger()
    config = createMinimalConfig()

    // Set up vault credentials
    await vault.set('github-pat', 'ghp_test123')

    // Set up mock upstream
    mockClient = new MockUpstreamClient({
      github: [
        { name: 'repos_list', description: 'List repos', inputSchema: { type: 'object', properties: {} } },
        { name: 'issues_create', description: 'Create issue', inputSchema: { type: 'object', properties: {} } },
      ],
      jira: [
        { name: 'issues_search', description: 'Search issues', inputSchema: { type: 'object', properties: {} } },
      ],
    })

    // Register tools
    registry.registerUpstreamTools('github', [
      { name: 'repos_list', description: 'List repos', inputSchema: { type: 'object', properties: {} } },
      { name: 'issues_create', description: 'Create issue', inputSchema: { type: 'object', properties: {} } },
    ])
    registry.registerUpstreamTools('jira', [
      { name: 'issues_search', description: 'Search issues', inputSchema: { type: 'object', properties: {} } },
    ])
    registry.registerNativeTools(getNativeToolEntries())
    registry.buildProfileViews({
      'claude-code': { allowed_servers: ['github'], denied_servers: ['jira'] },
      cursor: { allowed_servers: ['github', 'jira'], denied_servers: [] },
    })

    const upstreamClients = new Map<string, MockUpstreamClient>()
    upstreamClients.set('mock', mockClient)

    proxy = new McpProxy(
      registry,
      vault,
      audit as unknown as McpProxy extends new (...a: never[]) => infer T ? T extends { audit: infer A } ? A : never : never,
      upstreamClients as unknown as Map<string, import('../../../src/daemon/proxy.js').McpUpstreamClient>,
      config,
    )
  })

  describe('handleToolsList', () => {
    it('should return filtered tools for claude-code', () => {
      const tools = proxy.handleToolsList('claude-code')
      const names = tools.map((t) => t.name)

      expect(names).toContain('github__repos_list')
      expect(names).toContain('github__issues_create')
      expect(names).toContain('fam__whoami')
      expect(names).not.toContain('jira__issues_search')
    })

    it('should return all tools for cursor (which has both github and jira)', () => {
      const tools = proxy.handleToolsList('cursor')
      const names = tools.map((t) => t.name)

      expect(names).toContain('github__repos_list')
      expect(names).toContain('jira__issues_search')
      expect(names).toContain('fam__whoami')
    })

    it('should return empty for unknown profile', () => {
      const tools = proxy.handleToolsList('nonexistent')
      expect(tools).toEqual([])
    })
  })

  describe('handleToolCall', () => {
    it('should route native tool calls correctly', async () => {
      const result = await proxy.handleToolCall('claude-code', 'fam__whoami', {})

      expect(result.isError).toBeUndefined()
      const data = JSON.parse(result.content[0].text)
      expect(data.profile).toBe('claude-code')
    })

    it('should route upstream tool calls correctly', async () => {
      const result = await proxy.handleToolCall(
        'claude-code',
        'github__repos_list',
        { owner: 'test' },
      )

      expect(result.isError).toBeUndefined()

      // Verify the mock received the call
      const log = mockClient.getCallLog()
      expect(log).toHaveLength(1)
      expect(log[0].namespace).toBe('github')
      expect(log[0].toolName).toBe('repos_list')
    })

    it('should deny access to tools outside profile scope', async () => {
      const result = await proxy.handleToolCall(
        'claude-code',
        'jira__issues_search',
        {},
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Tool not found.')

      // Verify audit logged as denied
      const calls = audit.getCalls()
      expect(calls.some((c) => c.status === 'denied')).toBe(true)
    })

    it('should return error for unknown tool', async () => {
      const result = await proxy.handleToolCall(
        'claude-code',
        'nonexistent__tool',
        {},
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Tool not found.')
    })

    it('should return error for unknown profile', async () => {
      const result = await proxy.handleToolCall(
        'nonexistent',
        'github__repos_list',
        {},
      )

      // Profile not in config = denied
      expect(result.isError).toBe(true)
    })

    it('should log successful calls to audit', async () => {
      await proxy.handleToolCall('claude-code', 'github__repos_list', {})

      const calls = audit.getCalls()
      const githubCall = calls.find((c) => c.serverNs === 'github')
      expect(githubCall).toBeDefined()
      expect(githubCall?.status).toBe('success')
      expect(githubCall?.profile).toBe('claude-code')
    })

    it('should log native tool calls to audit', async () => {
      await proxy.handleToolCall('claude-code', 'fam__whoami', {})

      const calls = audit.getCalls()
      const famCall = calls.find((c) => c.serverNs === 'fam')
      expect(famCall).toBeDefined()
      expect(famCall?.status).toBe('success')
    })

    it('should return error when credential is missing', async () => {
      // Remove the credential from vault
      await vault.delete('github-pat')

      const result = await proxy.handleToolCall(
        'claude-code',
        'github__repos_list',
        {},
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Server authentication not configured. Contact your administrator.')
    })

    it('should handle upstream errors gracefully', async () => {
      mockClient.setCallResult('github', 'repos_list', {
        content: [{ type: 'text', text: 'Rate limit exceeded' }],
        isError: true,
      })

      const result = await proxy.handleToolCall(
        'claude-code',
        'github__repos_list',
        {},
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Rate limit exceeded')
    })
  })
})
