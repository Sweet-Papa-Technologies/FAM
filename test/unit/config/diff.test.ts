import { describe, it, expect } from 'vitest'
import { computeDiff, formatDiff } from '../../../src/config/diff.js'
import { createEmptyState } from '../../../src/config/state.js'
import type { FamConfig, State } from '../../../src/config/types.js'

// ─── Test Fixtures ──────────────────────────────────────────────

function makeMinimalConfig(overrides?: Partial<FamConfig>): FamConfig {
  return {
    version: '0.1',
    settings: {
      daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    credentials: {},
    mcp_servers: {},
    profiles: {
      default: {
        description: 'Default profile',
        config_target: 'generic',
        allowed_servers: [],
        denied_servers: [],
      },
    },
    generators: {},
    native_tools: {},
    instructions: { enabled: true, output_dir: '~/.fam/instructions/' },
    ...overrides,
  }
}

function makeMatchingState(config: FamConfig): State {
  const state = createEmptyState()
  state.last_applied = '2026-04-05T12:00:00Z'
  state.applied_config_hash = 'abc123'

  // Mirror credentials
  for (const [name, cred] of Object.entries(config.credentials)) {
    state.credentials[name] = {
      type: cred.type,
      exists_in_keychain: true,
      last_set: '2026-04-01T00:00:00Z',
    }
  }

  // Mirror servers
  for (const [name, server] of Object.entries(config.mcp_servers)) {
    if ('url' in server) {
      state.mcp_servers[name] = {
        transport: server.transport,
        url: server.url,
        credential: server.credential,
        status: 'healthy',
        tools_discovered: [],
      }
    } else {
      state.mcp_servers[name] = {
        transport: 'stdio',
        command: server.command,
        credential: server.credential ?? null,
        status: 'healthy',
        tools_discovered: [],
      }
    }
  }

  // Mirror profiles
  for (const [name, profile] of Object.entries(config.profiles)) {
    state.profiles[name] = {
      session_token_hash: 'hash_' + name,
      allowed_servers: [...profile.allowed_servers],
      tools_exposed_count: 0,
    }
  }

  // Mirror generators
  for (const [, profile] of Object.entries(config.profiles)) {
    const gen = config.generators[profile.config_target]
    if (gen) {
      state.generated_configs[profile.config_target] = {
        path: gen.output,
        last_written: '2026-04-05T12:00:00Z',
        content_hash: 'hash123',
        strategy: 'overwrite',
      }
    }
  }

  return state
}

// ─── Tests ──────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('should mark everything as added when state is empty', () => {
    const config = makeMinimalConfig({
      credentials: {
        'my-key': {
          type: 'api_key',
          description: 'Test',
        },
      },
      mcp_servers: {
        github: {
          url: 'https://api.github.com/mcp',
          transport: 'sse',
          credential: 'my-key',
          description: 'GitHub',
        },
      },
      profiles: {
        dev: {
          description: 'Dev profile',
          config_target: 'generic',
          allowed_servers: ['github'],
          denied_servers: [],
        },
      },
      generators: {
        generic: { output: '~/.fam/configs/dev.json', format: 'generic_mcp_list' },
      },
    })

    const emptyState = createEmptyState()
    const diff = computeDiff(config, emptyState)

    expect(diff.hasChanges).toBe(true)
    expect(diff.credentials.added).toHaveLength(1)
    expect(diff.credentials.added[0].name).toBe('my-key')
    expect(diff.servers.added).toHaveLength(1)
    expect(diff.servers.added[0].name).toBe('github')
    expect(diff.profiles.added).toHaveLength(1)
    expect(diff.profiles.added[0].name).toBe('dev')
    expect(diff.configs.added).toHaveLength(1)
    expect(diff.configs.added[0].name).toBe('generic')

    expect(diff.credentials.changed).toHaveLength(0)
    expect(diff.credentials.removed).toHaveLength(0)

    expect(diff.summary.toAdd).toBe(4)
    expect(diff.summary.toChange).toBe(0)
    expect(diff.summary.toRemove).toBe(0)
  })

  it('should report no changes when state matches config', () => {
    const config = makeMinimalConfig({
      credentials: {
        'my-key': { type: 'api_key', description: 'Test' },
      },
      mcp_servers: {
        github: {
          url: 'https://api.github.com/mcp',
          transport: 'sse',
          credential: 'my-key',
          description: 'GitHub',
        },
      },
      profiles: {
        dev: {
          description: 'Dev',
          config_target: 'generic',
          allowed_servers: ['github'],
          denied_servers: [],
        },
      },
      generators: {
        generic: { output: '~/.fam/configs/dev.json', format: 'generic_mcp_list' },
      },
    })

    const state = makeMatchingState(config)
    const diff = computeDiff(config, state)

    expect(diff.hasChanges).toBe(false)
    expect(diff.summary.toAdd).toBe(0)
    expect(diff.summary.toChange).toBe(0)
    expect(diff.summary.toRemove).toBe(0)
  })

  it('should detect added, changed, and removed items', () => {
    const config = makeMinimalConfig({
      credentials: {
        'existing-key': { type: 'api_key', description: 'Existing' },
        'new-key': { type: 'api_key', description: 'New' },
      },
      mcp_servers: {
        github: {
          url: 'https://api.github.com/mcp',
          transport: 'sse',
          credential: 'existing-key',
          description: 'GitHub',
        },
        'new-server': {
          url: 'https://new.example.com/mcp',
          transport: 'streamable_http',
          credential: null,
          description: 'New server',
        },
      },
      profiles: {
        dev: {
          description: 'Dev',
          config_target: 'generic',
          allowed_servers: ['github', 'new-server'],
          denied_servers: [],
        },
      },
      generators: {
        generic: { output: '~/.fam/configs/dev.json', format: 'generic_mcp_list' },
      },
    })

    // State has: existing-key, old-key(to be removed), github, old-server(to be removed)
    // dev profile has only ['github'] in state
    const state = createEmptyState()
    state.last_applied = '2026-04-05T12:00:00Z'
    state.applied_config_hash = 'abc'

    state.credentials['existing-key'] = {
      type: 'api_key',
      exists_in_keychain: true,
      last_set: '2026-04-01T00:00:00Z',
    }
    state.credentials['old-key'] = {
      type: 'api_key',
      exists_in_keychain: true,
      last_set: '2026-03-01T00:00:00Z',
    }

    state.mcp_servers['github'] = {
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      credential: 'existing-key',
      status: 'healthy',
      tools_discovered: [],
    }
    state.mcp_servers['old-server'] = {
      transport: 'sse',
      url: 'https://old.example.com/mcp',
      credential: null,
      status: 'unknown',
      tools_discovered: [],
    }

    state.profiles['dev'] = {
      session_token_hash: 'hash',
      allowed_servers: ['github'],
      tools_exposed_count: 5,
    }

    state.generated_configs['generic'] = {
      path: '~/.fam/configs/dev.json',
      last_written: '2026-04-05T12:00:00Z',
      content_hash: 'hash123',
      strategy: 'overwrite',
    }

    const diff = computeDiff(config, state)

    // Credentials: new-key added, old-key removed, existing-key unchanged
    expect(diff.credentials.added).toHaveLength(1)
    expect(diff.credentials.added[0].name).toBe('new-key')
    expect(diff.credentials.removed).toHaveLength(1)
    expect(diff.credentials.removed[0].name).toBe('old-key')
    expect(diff.credentials.changed).toHaveLength(0)

    // Servers: new-server added, old-server removed, github unchanged
    expect(diff.servers.added).toHaveLength(1)
    expect(diff.servers.added[0].name).toBe('new-server')
    expect(diff.servers.removed).toHaveLength(1)
    expect(diff.servers.removed[0].name).toBe('old-server')

    // Profiles: dev changed (added new-server access)
    expect(diff.profiles.changed).toHaveLength(1)
    expect(diff.profiles.changed[0].name).toBe('dev')
    expect(diff.profiles.changed[0].detail).toContain('new-server')

    // Configs: generic unchanged
    expect(diff.configs.added).toHaveLength(0)
    expect(diff.configs.removed).toHaveLength(0)

    expect(diff.hasChanges).toBe(true)
    expect(diff.summary.toAdd).toBe(2) // new-key + new-server
    expect(diff.summary.toChange).toBe(1) // dev profile
    expect(diff.summary.toRemove).toBe(2) // old-key + old-server
  })

  it('should detect credential type changes', () => {
    const config = makeMinimalConfig({
      credentials: {
        'my-cred': {
          type: 'oauth2',
          description: 'Now OAuth',
          provider: 'google',
          client_id: 'abc',
          scopes: ['read'],
        },
      },
    })

    const state = createEmptyState()
    state.credentials['my-cred'] = {
      type: 'api_key',
      exists_in_keychain: true,
      last_set: '2026-04-01T00:00:00Z',
    }

    const diff = computeDiff(config, state)
    expect(diff.credentials.changed).toHaveLength(1)
    expect(diff.credentials.changed[0].detail).toContain('type changed')
  })
})

describe('formatDiff', () => {
  it('should return no-changes message for empty diff', () => {
    const config = makeMinimalConfig()
    const state = makeMatchingState(config)
    const diff = computeDiff(config, state)
    const output = formatDiff(diff)
    expect(output).toBe('No changes. Infrastructure is up-to-date.')
  })

  it('should produce Terraform-style output with +/~/- prefixes', () => {
    const config = makeMinimalConfig({
      credentials: {
        'new-key': { type: 'api_key', description: 'New' },
      },
      mcp_servers: {
        'new-server': {
          url: 'https://example.com/mcp',
          transport: 'sse',
          credential: null,
          description: 'New server',
        },
      },
      profiles: {
        dev: {
          description: 'Dev',
          config_target: 'generic',
          allowed_servers: ['new-server'],
          denied_servers: [],
        },
      },
      generators: {
        generic: { output: '~/.fam/configs/dev.json', format: 'generic_mcp_list' },
      },
    })

    const emptyState = createEmptyState()
    const diff = computeDiff(config, emptyState)
    const output = formatDiff(diff)

    // Should contain + prefixes for additions
    expect(output).toContain('+ new-key')
    expect(output).toContain('+ new-server')
    expect(output).toContain('+ dev')
    expect(output).toContain('+ generic')

    // Should contain section headers
    expect(output).toContain('Credential changes:')
    expect(output).toContain('MCP server changes:')
    expect(output).toContain('Profile changes:')
    expect(output).toContain('Config files to update:')

    // Should contain summary line
    expect(output).toContain('Plan: 4 to add, 0 to change, 0 to destroy.')
  })

  it('should show change and remove markers', () => {
    const config = makeMinimalConfig({
      credentials: {
        'changed-cred': {
          type: 'oauth2',
          description: 'Changed',
          provider: 'google',
          client_id: 'abc',
          scopes: ['read'],
        },
      },
    })

    const state = createEmptyState()
    state.credentials['changed-cred'] = {
      type: 'api_key',
      exists_in_keychain: true,
      last_set: '2026-04-01T00:00:00Z',
    }
    state.credentials['removed-cred'] = {
      type: 'api_key',
      exists_in_keychain: true,
      last_set: '2026-03-01T00:00:00Z',
    }

    const diff = computeDiff(config, state)
    const output = formatDiff(diff)

    expect(output).toContain('~ changed-cred')
    expect(output).toContain('- removed-cred')
    expect(output).toContain('Plan:')
  })
})
