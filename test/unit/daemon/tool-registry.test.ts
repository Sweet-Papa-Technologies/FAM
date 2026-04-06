/**
 * test/unit/daemon/tool-registry.test.ts — ToolRegistry unit tests.
 *
 * Tests namespace prefixing, profile-based filtering, tool resolution,
 * and native tool inclusion.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../../../src/daemon/tool-registry.js'
import type { ToolDefinition, ToolEntry } from '../../../src/daemon/types.js'

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  const githubTools: ToolDefinition[] = [
    {
      name: 'repos_list',
      description: 'List repositories',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'issues_create',
      description: 'Create an issue',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
    },
  ]

  const jiraTools: ToolDefinition[] = [
    {
      name: 'issues_search',
      description: 'Search issues',
      inputSchema: { type: 'object', properties: {} },
    },
  ]

  const nativeEntries: ToolEntry[] = [
    {
      namespacedName: 'fam__whoami',
      upstreamName: 'whoami',
      namespace: 'fam',
      description: 'Returns your profile info',
      inputSchema: { type: 'object', properties: {} },
      source: 'native',
    },
    {
      namespacedName: 'fam__health',
      upstreamName: 'health',
      namespace: 'fam',
      description: 'Daemon health status',
      inputSchema: { type: 'object', properties: {} },
      source: 'native',
    },
  ]

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('registerUpstreamTools', () => {
    it('should add namespaced tools to the registry', () => {
      registry.registerUpstreamTools('github', githubTools)
      expect(registry.getToolCount()).toBe(2)
    })

    it('should prefix tool names with namespace__', () => {
      registry.registerUpstreamTools('github', githubTools)

      const profiles = { test: { allowed_servers: ['github'] } }
      registry.buildProfileViews(profiles)

      const tools = registry.getToolsForProfile('test')
      expect(tools.map((t) => t.name)).toEqual([
        'github__repos_list',
        'github__issues_create',
      ])
    })

    it('should prefix descriptions with [namespace]', () => {
      registry.registerUpstreamTools('github', githubTools)

      const profiles = { test: { allowed_servers: ['github'] } }
      registry.buildProfileViews(profiles)

      const tools = registry.getToolsForProfile('test')
      expect(tools[0].description).toBe('[github] List repositories')
      expect(tools[1].description).toBe('[github] Create an issue')
    })

    it('should register tools from multiple namespaces', () => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      expect(registry.getToolCount()).toBe(3)
    })
  })

  describe('registerNativeTools', () => {
    it('should add fam__ tools to the registry', () => {
      registry.registerNativeTools(nativeEntries)
      expect(registry.getToolCount()).toBe(2)
    })

    it('should preserve native tool names as-is', () => {
      registry.registerNativeTools(nativeEntries)

      const profiles = { test: { allowed_servers: [] } }
      registry.buildProfileViews(profiles)

      const tools = registry.getToolsForProfile('test')
      expect(tools.map((t) => t.name)).toContain('fam__whoami')
      expect(tools.map((t) => t.name)).toContain('fam__health')
    })
  })

  describe('buildProfileViews', () => {
    beforeEach(() => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      registry.registerNativeTools(nativeEntries)
    })

    it('should filter tools by allowed servers', () => {
      registry.buildProfileViews({
        dev: { allowed_servers: ['github'] },
      })

      const tools = registry.getToolsForProfile('dev')
      const names = tools.map((t) => t.name)

      expect(names).toContain('github__repos_list')
      expect(names).toContain('github__issues_create')
      expect(names).not.toContain('jira__issues_search')
    })

    it('should include native tools in all profiles', () => {
      registry.buildProfileViews({
        dev: { allowed_servers: ['github'] },
        pm: { allowed_servers: ['jira'] },
      })

      const devTools = registry.getToolsForProfile('dev')
      const pmTools = registry.getToolsForProfile('pm')

      expect(devTools.map((t) => t.name)).toContain('fam__whoami')
      expect(devTools.map((t) => t.name)).toContain('fam__health')
      expect(pmTools.map((t) => t.name)).toContain('fam__whoami')
      expect(pmTools.map((t) => t.name)).toContain('fam__health')
    })

    it('should exclude denied server tools', () => {
      registry.buildProfileViews({
        restricted: {
          allowed_servers: ['github', 'jira'],
          denied_servers: ['jira'],
        },
      })

      const tools = registry.getToolsForProfile('restricted')
      const names = tools.map((t) => t.name)

      expect(names).toContain('github__repos_list')
      expect(names).not.toContain('jira__issues_search')
    })

    it('should return empty array for unknown profile', () => {
      registry.buildProfileViews({})
      const tools = registry.getToolsForProfile('nonexistent')
      expect(tools).toEqual([])
    })

    it('should return only native tools when no servers allowed', () => {
      registry.buildProfileViews({
        sandboxed: { allowed_servers: [] },
      })

      const tools = registry.getToolsForProfile('sandboxed')
      expect(tools).toHaveLength(2) // only native tools
      expect(tools.every((t) => t.name.startsWith('fam__'))).toBe(true)
    })

    it('should allow multiple profiles with different views', () => {
      registry.buildProfileViews({
        dev: { allowed_servers: ['github'] },
        pm: { allowed_servers: ['jira'] },
        all: { allowed_servers: ['github', 'jira'] },
      })

      expect(registry.getToolsForProfile('dev').length).toBe(4) // 2 github + 2 native
      expect(registry.getToolsForProfile('pm').length).toBe(3)  // 1 jira + 2 native
      expect(registry.getToolsForProfile('all').length).toBe(5) // 2 github + 1 jira + 2 native
    })
  })

  describe('resolveToolCall', () => {
    beforeEach(() => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerNativeTools(nativeEntries)
    })

    it('should resolve upstream tool correctly', () => {
      const result = registry.resolveToolCall('github__repos_list')
      expect(result).toEqual({
        namespace: 'github',
        upstreamName: 'repos_list',
        source: 'upstream',
      })
    })

    it('should resolve native tool correctly', () => {
      const result = registry.resolveToolCall('fam__whoami')
      expect(result).toEqual({
        namespace: 'fam',
        upstreamName: 'whoami',
        source: 'native',
      })
    })

    it('should return null for unknown tool', () => {
      const result = registry.resolveToolCall('unknown__tool')
      expect(result).toBeNull()
    })

    it('should return null for completely invalid name', () => {
      const result = registry.resolveToolCall('notarealname')
      expect(result).toBeNull()
    })
  })

  describe('getAllNamespaces', () => {
    it('should return all upstream namespaces', () => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      registry.registerNativeTools(nativeEntries)

      const namespaces = registry.getAllNamespaces()
      expect(namespaces).toContain('github')
      expect(namespaces).toContain('jira')
      // Native tools should not be included in upstream namespaces
      expect(namespaces).not.toContain('fam')
    })
  })

  describe('getToolCount', () => {
    it('should return total tool count', () => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      registry.registerNativeTools(nativeEntries)

      expect(registry.getToolCount()).toBe(5) // 2 + 1 + 2
    })
  })

  describe('getToolCountByNamespace', () => {
    it('should return tool counts per namespace', () => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      registry.registerNativeTools(nativeEntries)

      const counts = registry.getToolCountByNamespace()
      expect(counts.github).toBe(2)
      expect(counts.jira).toBe(1)
      expect(counts.fam).toBe(2)
    })
  })

  describe('isNamespaceAllowedForProfile', () => {
    beforeEach(() => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerUpstreamTools('jira', jiraTools)
      registry.buildProfileViews({
        dev: { allowed_servers: ['github'] },
      })
    })

    it('should return true for allowed namespace', () => {
      expect(registry.isNamespaceAllowedForProfile('dev', 'github')).toBe(true)
    })

    it('should return false for disallowed namespace', () => {
      expect(registry.isNamespaceAllowedForProfile('dev', 'jira')).toBe(false)
    })

    it('should return false for unknown profile', () => {
      expect(registry.isNamespaceAllowedForProfile('unknown', 'github')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all tools and profile views', () => {
      registry.registerUpstreamTools('github', githubTools)
      registry.registerNativeTools(nativeEntries)
      registry.buildProfileViews({ dev: { allowed_servers: ['github'] } })

      expect(registry.getToolCount()).toBe(4)

      registry.clear()

      expect(registry.getToolCount()).toBe(0)
      expect(registry.getToolsForProfile('dev')).toEqual([])
    })
  })
})
