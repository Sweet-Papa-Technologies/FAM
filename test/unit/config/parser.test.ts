import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { parseConfig } from '../../../src/config/parser.js'
import { ConfigError } from '../../../src/utils/errors.js'

const FIXTURES = resolve(import.meta.dirname, '../../fixtures')

describe('parseConfig', () => {
  it('should parse valid-config.yaml successfully', () => {
    const config = parseConfig(resolve(FIXTURES, 'valid-config.yaml'))
    expect(config.version).toBe('0.1')
    expect(config.profiles['claude-code']).toBeDefined()
    expect(config.profiles['claude-code'].allowed_servers).toContain('github')
    expect(config.mcp_servers['github']).toBeDefined()
    expect(config.credentials['github-pat']).toBeDefined()
  })

  it('should parse minimal-config.yaml with defaults applied', () => {
    const config = parseConfig(resolve(FIXTURES, 'minimal-config.yaml'))
    expect(config.version).toBe('0.1')
    expect(config.settings.daemon.port).toBe(7865)
    expect(config.credentials).toEqual({})
    expect(config.mcp_servers).toEqual({})
  })

  it('should throw ConfigError for missing file', () => {
    expect(() => parseConfig('/nonexistent/path/fam.yaml')).toThrowError(ConfigError)

    try {
      parseConfig('/nonexistent/path/fam.yaml')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('CONFIG_FILE_NOT_FOUND')
    }
  })

  it('should throw ConfigError for invalid YAML', () => {
    const tmpDir = join(tmpdir(), `fam-test-${randomBytes(4).toString('hex')}`)
    mkdirSync(tmpDir, { recursive: true })
    const badYaml = join(tmpDir, 'bad.yaml')
    writeFileSync(badYaml, '{{{{invalid yaml: [[[', 'utf-8')

    try {
      expect(() => parseConfig(badYaml)).toThrowError(ConfigError)

      try {
        parseConfig(badYaml)
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('CONFIG_YAML_PARSE_ERROR')
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should throw ConfigError for schema validation failure', () => {
    expect(() =>
      parseConfig(resolve(FIXTURES, 'invalid-configs/missing-profiles.yaml')),
    ).toThrowError(ConfigError)

    try {
      parseConfig(resolve(FIXTURES, 'invalid-configs/missing-profiles.yaml'))
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('CONFIG_VALIDATION_ERROR')
      expect((err as ConfigError).message).toContain('profiles')
    }
  })

  describe('env var resolution', () => {
    const tmpDir = join(tmpdir(), `fam-test-${randomBytes(4).toString('hex')}`)
    const configPath = join(tmpDir, 'env-test.yaml')

    beforeEach(() => {
      mkdirSync(tmpDir, { recursive: true })
      process.env['FAM_TEST_CLIENT_ID'] = 'resolved-client-id-123'
    })

    afterEach(() => {
      delete process.env['FAM_TEST_CLIENT_ID']
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('should resolve ${ENV_VAR} references in string values', () => {
      const yaml = `
version: "0.1"
credentials:
  test-oauth:
    type: oauth2
    description: "Test OAuth"
    provider: google
    client_id: \${FAM_TEST_CLIENT_ID}
    scopes:
      - read
profiles:
  default:
    description: "Default"
    config_target: generic
    allowed_servers: []
`
      writeFileSync(configPath, yaml, 'utf-8')
      const config = parseConfig(configPath)
      const cred = config.credentials['test-oauth']
      expect(cred.type).toBe('oauth2')
      if (cred.type === 'oauth2') {
        expect(cred.client_id).toBe('resolved-client-id-123')
      }
    })

    it('should leave unset env vars as-is', () => {
      const yaml = `
version: "0.1"
credentials:
  test-oauth:
    type: oauth2
    description: "Test OAuth"
    provider: google
    client_id: \${NONEXISTENT_FAM_VAR}
    scopes:
      - read
profiles:
  default:
    description: "Default"
    config_target: generic
    allowed_servers: []
`
      writeFileSync(configPath, yaml, 'utf-8')
      const config = parseConfig(configPath)
      const cred = config.credentials['test-oauth']
      if (cred.type === 'oauth2') {
        expect(cred.client_id).toBe('${NONEXISTENT_FAM_VAR}')
      }
    })
  })
})
