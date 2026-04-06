import { describe, it, expect } from 'vitest'
import { generateOpenCodeConfig } from '../../../src/generators/opencode.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

const baseInput: GeneratorInput = {
  profile: {
    name: 'opencode',
    description: 'OpenCode IDE',
    config_target: 'opencode',
    allowed_servers: ['github'],
    denied_servers: [],
  },
  settings: {
    daemon: { port: 7865, socket: '~/.fam/agent.sock', auto_start: false },
    audit: { enabled: true, retention_days: 90, export_format: 'json' as const },
  },
  sessionToken: 'fam_sk_opn_abc123',
  daemonUrl: 'http://localhost:7865',
}

describe('OpenCode config generator', () => {
  it('produces valid JSON', () => {
    const output = generateOpenCodeConfig(baseInput)
    expect(() => JSON.parse(output.content)).not.toThrow()
  })

  it('uses "mcp" root key (not "mcpServers")', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config).toHaveProperty('mcp')
    expect(config).not.toHaveProperty('mcpServers')
  })

  it('uses type: remote for the FAM entry', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.mcp.fam.type).toBe('remote')
  })

  it('includes correct URL', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.mcp.fam.url).toBe('http://localhost:7865/mcp')
  })

  it('includes Authorization header with Bearer token', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.mcp.fam.headers.Authorization).toBe('Bearer fam_sk_opn_abc123')
  })

  it('sets enabled: true', () => {
    const output = generateOpenCodeConfig(baseInput)
    const config = JSON.parse(output.content)
    expect(config.mcp.fam.enabled).toBe(true)
  })

  it('outputs to ~/.config/opencode/opencode.json', () => {
    const output = generateOpenCodeConfig(baseInput)
    expect(output.path).toContain('.config/opencode/opencode.json')
  })

  it('format is json', () => {
    const output = generateOpenCodeConfig(baseInput)
    expect(output.format).toBe('json')
  })
})
