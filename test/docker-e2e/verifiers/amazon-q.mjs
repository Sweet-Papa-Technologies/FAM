/**
 * verifiers/amazon-q.mjs -- Runtime verification for Amazon Q Developer CLI.
 *
 * Q requires AWS SSO login (browser device flow) which cannot reasonably run
 * in a hermetic container. This verifier therefore does best-effort only:
 *
 *   - If `q` is already on PATH and authenticated, try `q mcp list` and
 *     assert "fam" appears.
 *   - Otherwise, skip with a clear reason (test is marked `skip`, not `fail`).
 *
 * To enable full Q testing in an authed environment, pre-bake the container
 * with the user's SSO cache at ~/.aws/sso/cache/* and set E2E_AMAZONQ_AUTHED=1.
 */

import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'amazon_q',
  display: 'Amazon Q',
  install: 'manual (AWS SSO required)',
  binary: 'q',
  configPath: '~/.aws/amazonq/agents/default.json',
  supportsLivePrompt: false,
  skipUnlessAuthed: true,
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

function isInstalledAndAuthed() {
  const probe = runAgent('q --version', { timeout: 5_000 })
  if (!probe.ok) return { ok: false, reason: 'q CLI not installed in container' }
  if (!process.env.E2E_AMAZONQ_AUTHED) {
    return { ok: false, reason: 'set E2E_AMAZONQ_AUTHED=1 with pre-baked SSO cache to enable' }
  }
  const auth = runAgent('q whoami', { timeout: 10_000 })
  if (!auth.ok) return { ok: false, reason: `q whoami failed: ${auth.stderr.slice(0, 200)}` }
  return { ok: true }
}

export async function verify(parentConfig, llmState) {
  const state = isInstalledAndAuthed()
  if (!state.ok) {
    return { skip: true, reason: state.reason, checks: [] }
  }

  const outputPath = expandHome(meta.configPath)
  const { ctx, port, token } = await setupRuntimeContext({
    agentKey: 'amazon_q',
    configTarget: 'amazon_q',
    generatorOutput: outputPath,
    parentConfig,
  })

  const checks = []
  try {
    const mcp = runAgent('q mcp list', { timeout: 20_000 })
    const clean = stripAnsi(mcp.stdout + '\n' + mcp.stderr)
    checks.push(check('`q mcp list` shows "fam"', () => {
      if (!clean.toLowerCase().includes('fam')) {
        throw new Error(`no "fam" in output:\n${clean.slice(0, 400)}`)
      }
    }))

    if (token) {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      const body = await resp.json()
      const tools = body?.result?.tools || []
      checks.push(check('daemon exposes filesystem tools to Q token', () => {
        if (tools.filter(t => t.name?.startsWith('filesystem__')).length === 0) {
          throw new Error(`no filesystem__ tools in daemon response`)
        }
      }))
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
