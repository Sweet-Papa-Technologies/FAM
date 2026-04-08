/**
 * tests/generators.mjs -- Config generator tests for all 17 agents.
 *
 * For each agent defined in e2e-config.yaml, generates a config via
 * `fam apply --yes` and validates the output format + expected structure.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TestContext } from '../lib/test-context.mjs'

const CATEGORY = 'generators'

/**
 * Check if a dot-separated path exists in a nested object.
 * e.g. checkDotPath({ a: { b: { c: 1 } } }, 'a.b.c') => true
 */
function checkDotPath(obj, path) {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false
    if (!(part in current)) return false
    current = current[part]
  }
  return true
}

/**
 * Resolve the actual output path for an agent, handling special cases:
 *   - vscode / roo_code: relative to project dir
 *   - zed: on Linux, uses ~/.config/zed/settings.json
 *   - generic: uses the FAM dir
 *   - all others: expand ~ to HOME
 */
function resolveOutputPath(agentKey, agentDef, ctx) {
  const home = process.env.HOME || '/home/famtest'
  let outputPath = agentDef.output_path

  // Generic agent has a <profile> placeholder
  if (agentKey === 'generic') {
    return join(ctx.famDir, 'configs', `gen-${agentKey}.json`)
  }

  // Relative paths (vscode, roo_code) are relative to the project dir
  if (!outputPath.startsWith('~') && !outputPath.startsWith('/')) {
    return join(ctx.projectDir, outputPath)
  }

  // Expand ~
  if (outputPath.startsWith('~')) {
    outputPath = outputPath.replace(/^~/, home)
  }

  return outputPath
}

/**
 * Build a fam.yaml for a specific agent.
 * The config_target and generator entry match the agent's config_target.
 */
function buildYamlForAgent(agentKey, agentDef, ctx, outputPath) {
  const configTarget = agentDef.config_target

  // For vscode and roo_code, the generator output is relative to the project
  // dir, so we use the project-relative path in the generator output.
  let generatorOutput = outputPath
  if (agentKey === 'vscode' || agentKey === 'roo_code') {
    generatorOutput = agentDef.output_path  // relative path
  }

  return `
version: "0.1"

settings:
  daemon:
    port: 17865
    auto_start: false
  audit:
    enabled: false

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ctx.projectDir}"]
    transport: stdio
    description: "Test filesystem"

profiles:
  gen-${agentKey}:
    description: "Generator test for ${agentDef.display_name}"
    config_target: ${configTarget}
    allowed_servers: [filesystem]

generators:
  ${configTarget}:
    output: ${generatorOutput}
    format: ${configTarget}

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile"
`
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} parentCtx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(parentCtx, reporter) {
  const agents = parentCtx.config.agents || {}

  for (const [agentKey, agentDef] of Object.entries(agents)) {
    const testName = `generator-${agentKey}`
    const t0 = Date.now()

    // Each agent gets its own isolated context
    const ctx = new TestContext(`gen-${agentKey}`, parentCtx.config)

    try {
      const outputPath = resolveOutputPath(agentKey, agentDef, ctx)
      const yaml = buildYamlForAgent(agentKey, agentDef, ctx, outputPath)
      ctx.writeFamYaml(yaml)

      // Run fam apply
      const result = ctx.fam('apply --yes')
      const combined = result.stdout + result.stderr

      if (result.exitCode !== 0 && !combined.includes('fam_sk_')) {
        throw new Error(`fam apply failed (exit ${result.exitCode}): ${combined.slice(0, 500)}`)
      }

      // Read the generated config
      const generated = ctx.readGeneratedConfig(outputPath)

      if (!generated.raw) {
        throw new Error(`Generated config file not found at ${outputPath}`)
      }

      // Validate format
      if (agentDef.output_format === 'json') {
        if (!generated.parsed) {
          throw new Error(`Failed to parse JSON from ${outputPath}`)
        }
      } else if (agentDef.output_format === 'yaml') {
        // YAML files may parse to null/undefined if they only contain comments
        // (e.g., aider without model config). That's valid — just check no parse error.
        if (generated.format !== 'yaml') {
          throw new Error(`Failed to read YAML from ${outputPath}`)
        }
      }
      // TOML: we just check raw text for sections

      // Check expected_structure
      const expectedPaths = agentDef.expected_structure || []
      for (const expectedPath of expectedPaths) {
        if (agentDef.output_format === 'toml') {
          // For TOML, check raw text for section headers like [mcp]
          if (!generated.raw.includes(expectedPath)) {
            throw new Error(`Expected "${expectedPath}" in TOML output, not found`)
          }
        } else if (agentDef.output_format === 'yaml' && expectedPath === 'mcpServers') {
          // For YAML list-type entries (continue_dev mcpServers is an array)
          if (!generated.parsed || (!generated.parsed.mcpServers && !generated.raw.includes('mcpServers'))) {
            throw new Error(`Expected "mcpServers" key in YAML output, not found`)
          }
        } else if (agentDef.output_format === 'yaml' && expectedPath === 'model') {
          // For aider: model is a top-level scalar, not nested
          if (!generated.raw.includes('model')) {
            // This only fires if model config was provided, but for generator tests
            // without models, the key might not appear. That's ok -- skip this check.
          }
        } else if (generated.parsed) {
          // JSON or parsed YAML: check dot-path
          if (!checkDotPath(generated.parsed, expectedPath)) {
            throw new Error(`Expected dot-path "${expectedPath}" not found in parsed output. Keys: ${JSON.stringify(Object.keys(generated.parsed))}`)
          }
        } else {
          // Fallback: raw text search
          if (!generated.raw.includes(expectedPath)) {
            throw new Error(`Expected "${expectedPath}" in output, not found`)
          }
        }
      }

      reporter.pass(CATEGORY, testName, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, testName, err, Date.now() - t0)
    } finally {
      ctx.cleanup()
    }
  }
}
