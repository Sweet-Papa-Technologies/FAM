/**
 * tests/runtime-verification.mjs -- Runtime verification for officially-supported agents.
 *
 * For each agent in VERIFIERS:
 *   1. Install the agent binary (if not already on PATH)
 *   2. Clean its global config path
 *   3. Spin up a TestContext → fam apply → fam daemon start
 *   4. Run the agent's own CLI (`claude mcp list`, `opencode mcp list`, etc.)
 *      and assert it reports FAM as connected
 *   5. Optionally run a live prompt against gemma4:e2b (Ollama) if reachable
 *
 * Each verifier reports a list of sub-checks. If any sub-check fails, the agent's
 * test fails. If the agent can't be installed, it's skipped (not failed) so CI
 * output clearly distinguishes "environment problem" from "FAM broken."
 */

import { execSync } from 'node:child_process'
import { verify as verifyClaudeCode, meta as claudeMeta } from '../verifiers/claude-code.mjs'
import { verify as verifyOpenCode, meta as openCodeMeta } from '../verifiers/opencode.mjs'
import { verify as verifyGeminiCli, meta as geminiMeta } from '../verifiers/gemini-cli.mjs'
import { verify as verifyAider, meta as aiderMeta } from '../verifiers/aider.mjs'
import { verify as verifyOpenClaw, meta as openClawMeta } from '../verifiers/openclaw.mjs'
import { verify as verifyAmazonQ, meta as amazonQMeta } from '../verifiers/amazon-q.mjs'
import { probeLlm, cleanGlobalConfig } from '../lib/runtime-harness.mjs'

const CATEGORY = 'runtime-verification'

const VERIFIERS = [
  { meta: claudeMeta, verify: verifyClaudeCode },
  { meta: openCodeMeta, verify: verifyOpenCode },
  { meta: geminiMeta, verify: verifyGeminiCli },
  { meta: aiderMeta, verify: verifyAider },
  { meta: openClawMeta, verify: verifyOpenClaw },
  { meta: amazonQMeta, verify: verifyAmazonQ },
]

function expandHome(p) {
  return (p || '').replace(/^~/, process.env.HOME || '/home/famtest')
}

/**
 * Is the binary already on PATH? (Avoid reinstalling between runs of the same container.)
 */
function binaryOnPath(name) {
  try {
    execSync(`command -v ${name}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Try to install the agent. Returns { ok, reason? }.
 */
function install(meta) {
  if (!meta.install || meta.install.startsWith('manual')) {
    return { ok: false, reason: `manual install required (${meta.install})` }
  }
  if (binaryOnPath(meta.binary)) {
    return { ok: true, already: true }
  }
  const isPip = meta.install.startsWith('pip')
  const timeout = isPip ? 240_000 : 180_000
  try {
    execSync(meta.install, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PIP_BREAK_SYSTEM_PACKAGES: '1' },
    })
    if (!binaryOnPath(meta.binary)) {
      return { ok: false, reason: `install ran but ${meta.binary} still not on PATH` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `install failed: ${(err.stderr || err.message || '').slice(0, 300)}` }
  }
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} parentCtx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(parentCtx, reporter) {
  const llmConfig = parentCtx.config.llm || {}
  const llmState = await probeLlm(llmConfig.base_url, llmConfig.model_id)
  console.log(
    `  LLM probe: base_url=${llmConfig.base_url} reachable=${llmState.reachable} hasModel=${llmState.hasModel}` +
    (llmState.reason ? ` (${llmState.reason})` : ''),
  )
  if (!llmState.reachable) {
    console.log(`  Live prompts will be skipped — set up Ollama with \`ollama pull ${llmConfig.model_id}\` to enable.`)
  } else if (!llmState.hasModel) {
    console.log(`  Ollama reachable but ${llmConfig.model_id} not pulled — live prompts will be skipped.`)
  }

  for (const { meta, verify } of VERIFIERS) {
    const testName = `runtime-${meta.key}`
    const t0 = Date.now()

    // --- Install ---------------------------------------------------------
    console.log(`  Installing ${meta.display}...`)
    const inst = install(meta)
    if (!inst.ok) {
      reporter.skip(CATEGORY, testName, inst.reason)
      continue
    }

    // --- Clean any stale global config ----------------------------------
    const paths = [meta.configPath]
    if (meta.secondaryConfigPath) paths.push(meta.secondaryConfigPath)
    cleanGlobalConfig(paths.map(expandHome))

    // --- Run verifier ----------------------------------------------------
    try {
      const result = await verify(parentCtx.config, llmState)

      if (result.skip) {
        reporter.skip(CATEGORY, testName, result.reason || 'verifier skipped')
        continue
      }

      const failures = result.checks.filter(c => !c.pass)
      if (failures.length > 0) {
        const summary = failures.map(f => `• ${f.label}: ${f.error}`).join('\n')
        reporter.fail(CATEGORY, testName, new Error(`${failures.length}/${result.checks.length} checks failed:\n${summary}`), Date.now() - t0)
      } else {
        reporter.pass(CATEGORY, testName, Date.now() - t0)
      }
    } catch (err) {
      reporter.fail(CATEGORY, testName, err, Date.now() - t0)
    }
  }
}
