/**
 * tests/core-cli.mjs -- Core CLI pipeline tests.
 *
 * Exercises: fam plan, validate, apply, status, drift (clean + detected),
 * and plan-no-changes.
 */

import { existsSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CATEGORY = 'core-cli'

/**
 * Build a minimal fam.yaml for core CLI tests.
 * Uses generic config_target + a filesystem stdio server.
 */
function buildYaml(ctx) {
  return `
version: "0.1"

settings:
  daemon:
    port: 17865
    auto_start: false
  audit:
    enabled: true

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ctx.projectDir}"]
    transport: stdio
    description: "Test filesystem"

profiles:
  test-profile:
    description: "Test profile"
    config_target: generic
    allowed_servers: [filesystem]

generators:
  generic:
    output: ${ctx.famDir}/configs/test.json
    format: generic_mcp_list

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile"
`
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} ctx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(ctx, reporter) {
  ctx.writeFamYaml(buildYaml(ctx))

  const generatedConfigPath = join(ctx.famDir, 'configs', 'test.json')
  const statePath = join(ctx.famDir, 'state.json')

  // 1. fam plan
  {
    const name = 'fam-plan'
    const t0 = Date.now()
    try {
      const result = ctx.fam('plan')
      const combined = result.stdout + result.stderr
      if (!combined.includes('test-profile')) {
        throw new Error(`Expected "test-profile" in plan output, got: ${combined.slice(0, 500)}`)
      }
      if (!combined.toLowerCase().includes('to add') && !combined.toLowerCase().includes('add')) {
        throw new Error(`Expected "to add" in plan output, got: ${combined.slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 2. fam validate
  {
    const name = 'fam-validate'
    const t0 = Date.now()
    try {
      const result = ctx.fam('validate')
      const combined = result.stdout + result.stderr
      if (!combined.includes('Config schema valid')) {
        throw new Error(`Expected "Config schema valid" in validate output, got: ${combined.slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 3. fam apply --yes
  {
    const name = 'fam-apply'
    const t0 = Date.now()
    try {
      const result = ctx.fam('apply --yes')
      const combined = result.stdout + result.stderr

      if (!existsSync(statePath)) {
        throw new Error(`state.json not found at ${statePath}`)
      }
      if (!existsSync(generatedConfigPath)) {
        throw new Error(`Generated config not found at ${generatedConfigPath}`)
      }
      // The token is printed on apply
      if (!combined.includes('fam_sk_')) {
        throw new Error(`Expected session token (fam_sk_) in apply output, got: ${combined.slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 4. fam status
  {
    const name = 'fam-status'
    const t0 = Date.now()
    try {
      const result = ctx.fam('status')
      const combined = result.stdout + result.stderr
      // Status should mention daemon and config information
      if (!combined.toLowerCase().includes('daemon') && !combined.toLowerCase().includes('config')) {
        throw new Error(`Expected daemon/config info in status output, got: ${combined.slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 5. fam drift (clean -- no changes)
  {
    const name = 'fam-drift-clean'
    const t0 = Date.now()
    try {
      const result = ctx.fam('drift')
      if (result.exitCode !== 0) {
        throw new Error(`Expected exit code 0 for clean drift, got ${result.exitCode}. Output: ${(result.stdout + result.stderr).slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 6. fam drift (detected -- after modifying the generated config)
  {
    const name = 'fam-drift-detected'
    const t0 = Date.now()
    try {
      if (!existsSync(generatedConfigPath)) {
        throw new Error('Generated config does not exist; cannot test drift detection')
      }
      // Append garbage to the generated config to cause drift
      appendFileSync(generatedConfigPath, '\n// drift injected\n', 'utf-8')

      const result = ctx.fam('drift')
      // Drift detected should exit with code 2
      if (result.exitCode !== 2) {
        throw new Error(`Expected exit code 2 for drift detected, got ${result.exitCode}. Output: ${(result.stdout + result.stderr).slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 7. fam plan (no changes -- re-apply first to clear drift, then plan)
  {
    const name = 'fam-plan-no-changes'
    const t0 = Date.now()
    try {
      // Re-apply to restore clean state
      ctx.fam('apply --yes')

      const result = ctx.fam('plan')
      const combined = result.stdout + result.stderr
      const lower = combined.toLowerCase()
      if (!lower.includes('no changes') && !lower.includes('up-to-date') && !lower.includes('up to date')) {
        throw new Error(`Expected "no changes" or "up-to-date" in plan output, got: ${combined.slice(0, 500)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }
}
