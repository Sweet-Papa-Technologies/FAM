import { describe, it, expect } from 'vitest'
import { generateOpenHandsConfig } from '../../../src/generators/openhands.js'
import type { GeneratorInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<GeneratorInput>): GeneratorInput {
  return {
    profile: {
      name: 'openhands',
      description: 'OpenHands agent',
      config_target: '~/.openhands/config.toml',
      allowed_servers: ['github'],
      denied_servers: [],
    },
    settings: {
      daemon: { port: 7865, socket: '/tmp/fam.sock', auto_start: true },
      audit: { enabled: true, retention_days: 90, export_format: 'json' },
    },
    sessionToken: 'fam_sk_oh_m3n4o5p6',
    daemonUrl: 'http://localhost:7865',
    ...overrides,
  }
}

describe('generateOpenHandsConfig', () => {
  it('should produce TOML format output', () => {
    const result = generateOpenHandsConfig(makeInput())
    expect(result.format).toBe('toml')
  })

  it('should contain an [mcp] section with fam server', () => {
    const result = generateOpenHandsConfig(makeInput())
    expect(result.content).toContain('[mcp]')
    expect(result.content).toContain('sse_servers = [')
    expect(result.content).toContain('url = "http://localhost:7865/mcp"')
    expect(result.content).toContain('api_key = "fam_sk_oh_m3n4o5p6"')
  })

  it('should include the session token in the server entry', () => {
    const result = generateOpenHandsConfig(makeInput())
    expect(result.content).toContain('api_key = "fam_sk_oh_m3n4o5p6"')
  })

  it('should NOT include [llm] section when env_inject is absent', () => {
    const result = generateOpenHandsConfig(makeInput())
    expect(result.content).not.toContain('[llm]')
  })

  it('should include [llm] section when env_inject has model config', () => {
    const result = generateOpenHandsConfig(
      makeInput({
        profile: {
          name: 'openhands',
          description: 'OpenHands agent',
          config_target: '~/.openhands/config.toml',
          allowed_servers: ['github'],
          denied_servers: [],
          model: 'claude-sonnet-4',
          env_inject: {
            api_key: 'sk-ant-abc123',
          },
        },
      })
    )
    expect(result.content).toContain('[llm]')
    expect(result.content).toContain('api_key = "sk-ant-abc123"')
    expect(result.content).toContain('model = "claude-sonnet-4"')
  })

  it('should expand tilde in the output path', () => {
    const result = generateOpenHandsConfig(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.openhands/config.toml')
  })

  it('should handle daemon URL with trailing slash', () => {
    const result = generateOpenHandsConfig(
      makeInput({ daemonUrl: 'http://localhost:7865/' })
    )
    expect(result.content).toContain('url = "http://localhost:7865/mcp"')
  })

  it('should use ANTHROPIC_API_KEY from env_inject as api_key', () => {
    const result = generateOpenHandsConfig(
      makeInput({
        profile: {
          name: 'openhands',
          description: 'OpenHands agent',
          config_target: '~/.openhands/config.toml',
          allowed_servers: ['github'],
          denied_servers: [],
          env_inject: {
            ANTHROPIC_API_KEY: 'sk-ant-xyz789',
          },
        },
      })
    )
    expect(result.content).toContain('[llm]')
    expect(result.content).toContain('api_key = "sk-ant-xyz789"')
  })
})
