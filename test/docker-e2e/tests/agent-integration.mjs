/**
 * tests/agent-integration.mjs -- Integration tests for installable agents.
 *
 * For each agent where installable=true, attempts to install it, then
 * verifies that FAM can generate config and that the agent binary works.
 * Agents that fail to install are skipped (not failed).
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TestContext } from '../lib/test-context.mjs'

const CATEGORY = 'agent-integration'

/**
 * Resolve the output path for an agent (same logic as generators.mjs).
 */
function resolveOutputPath(agentKey, agentDef, ctx) {
  const home = process.env.HOME || '/home/famtest'
  let outputPath = agentDef.output_path

  if (agentKey === 'generic') {
    return join(ctx.famDir, 'configs', `int-${agentKey}.json`)
  }

  if (!outputPath.startsWith('~') && !outputPath.startsWith('/')) {
    return join(ctx.projectDir, outputPath)
  }

  if (outputPath.startsWith('~')) {
    outputPath = outputPath.replace(/^~/, home)
  }

  return outputPath
}

/**
 * Try to install an agent. Returns { success, error }.
 */
function tryInstall(installCommand, agentName) {
  // Use longer timeout for pip installs (180s) vs npm (120s)
  const isPip = installCommand.startsWith('pip')
  const timeout = isPip ? 180_000 : 120_000

  try {
    execSync(installCommand, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // pip needs --break-system-packages on Debian Bookworm
        PIP_BREAK_SYSTEM_PACKAGES: '1',
      },
    })
    return { success: true, error: null }
  } catch (err) {
    return {
      success: false,
      error: `Install failed: ${(err.stderr || err.message || '').slice(0, 300)}`,
    }
  }
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} parentCtx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(parentCtx, reporter) {
  const agents = parentCtx.config.agents || {}

  for (const [agentKey, agentDef] of Object.entries(agents)) {
    // Only test installable agents
    if (!agentDef.installable || !agentDef.install_command) {
      continue
    }

    const testName = `agent-${agentKey}`
    const t0 = Date.now()

    // Step 1: Install the agent
    console.log(`  Installing ${agentDef.display_name}...`)
    const install = tryInstall(agentDef.install_command, agentKey)

    if (!install.success) {
      reporter.skip(CATEGORY, testName, install.error)
      continue
    }

    // Step 2: Create a fresh context and generate config
    const ctx = new TestContext(`int-${agentKey}`, parentCtx.config)
    try {
      const outputPath = resolveOutputPath(agentKey, agentDef, ctx)
      const configTarget = agentDef.config_target

      let generatorOutput = outputPath
      if (agentKey === 'vscode' || agentKey === 'roo_code') {
        generatorOutput = agentDef.output_path
      }

      const yaml = `
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
  int-${agentKey}:
    description: "Integration test for ${agentDef.display_name}"
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
      ctx.writeFamYaml(yaml)

      const result = ctx.fam('apply --yes')
      const combined = result.stdout + result.stderr

      // Verify generated config exists
      if (!existsSync(outputPath)) {
        throw new Error(`Generated config not found at ${outputPath} after apply. Output: ${combined.slice(0, 300)}`)
      }

      // Step 3: Run verify_command if defined
      if (agentDef.verify_command) {
        try {
          execSync(agentDef.verify_command, {
            encoding: 'utf-8',
            timeout: 30_000,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        } catch (verifyErr) {
          throw new Error(`verify_command "${agentDef.verify_command}" failed: ${(verifyErr.stderr || verifyErr.message || '').slice(0, 300)}`)
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
