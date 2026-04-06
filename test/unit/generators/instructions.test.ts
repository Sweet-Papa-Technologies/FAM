import { describe, it, expect } from 'vitest'
import { generateInstructionFile } from '../../../src/generators/instructions.js'
import type { InstructionInput } from '../../../src/generators/types.js'

function makeInput(overrides?: Partial<InstructionInput>): InstructionInput {
  return {
    profile: {
      name: 'claude-code',
      description: 'Claude Code agent',
      config_target: '~/.claude/settings.json',
      allowed_servers: ['github', 'n8n'],
      denied_servers: [],
    },
    servers: {
      github: {
        description: 'GitHub repos, issues, PRs',
        tools: ['create_issue', 'list_repos', 'create_pr'],
      },
      n8n: {
        description: 'Local n8n workflow engine',
        tools: ['run_workflow', 'list_workflows'],
      },
    },
    nativeTools: [
      'fam.whoami',
      'fam.log_action',
      'fam.list_servers',
      'fam.health',
    ],
    ...overrides,
  }
}

describe('generateInstructionFile', () => {
  it('should generate markdown content', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.format).toBe('markdown')
  })

  it('should include the profile name', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('### Your profile: claude-code')
  })

  it('should include server names and descriptions', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('**github**: GitHub repos, issues, PRs')
    expect(result.content).toContain('**n8n**: Local n8n workflow engine')
  })

  it('should include server tools', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('create_issue, list_repos, create_pr')
    expect(result.content).toContain('run_workflow, list_workflows')
  })

  it('should include FAM native tools', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('**fam.whoami**')
    expect(result.content).toContain('**fam.log_action**')
    expect(result.content).toContain('**fam.list_servers**')
    expect(result.content).toContain('**fam.health**')
  })

  it('should include the Available Infrastructure header', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('## Available Infrastructure (via FAM)')
  })

  it('should include MCP connection instructions', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.content).toContain('Connect via MCP at localhost:7865/mcp')
    expect(result.content).toContain('Do not hardcode or request any API keys')
  })

  it('should append extra context when provided', () => {
    const result = generateInstructionFile(
      makeInput({
        extraContext: 'Always prefer using GitHub Actions for CI/CD.',
      })
    )
    expect(result.content).toContain(
      'Always prefer using GitHub Actions for CI/CD.'
    )
  })

  it('should NOT include extra context when not provided', () => {
    const result = generateInstructionFile(makeInput())
    // Content should end with the usage section and a trailing newline
    const lines = result.content.split('\n')
    const nonEmptyLines = lines.filter((l) => l.trim() !== '')
    const lastLine = nonEmptyLines[nonEmptyLines.length - 1]
    expect(lastLine).toContain('Do not hardcode or request any API keys')
  })

  it('should default output path to ~/.fam/instructions/<profile>.md', () => {
    const result = generateInstructionFile(makeInput())
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('.fam/instructions/claude-code.md')
  })

  it('should use inject_into path when provided', () => {
    const result = generateInstructionFile(
      makeInput({ injectInto: '~/project/AGENTS.md' })
    )
    expect(result.path).not.toContain('~')
    expect(result.path).toContain('AGENTS.md')
  })
})
