/**
 * verifiers/openclaw.mjs -- Runtime verification for OpenClaw.
 *
 * OpenClaw is a Claude-Code-family wrapper. Its CLI surface varies by release,
 * so we try the most likely inspection commands (`mcp list`, `--check`, `status`)
 * and succeed if any of them echo the fam config. If none work but the config
 * files are correct, we flag the check as soft-pass and continue.
 */

import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'openclaw',
  display: 'OpenClaw',
  install: 'npm i -g openclaw',
  binary: 'openclaw',
  configPath: '~/.openclaw/openclaw.json',
  supportsLivePrompt: true,
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

export async function verify(parentConfig, llmState) {
  const outputPath = expandHome(meta.configPath)
  const { ctx, port, token } = await setupRuntimeContext({
    agentKey: 'openclaw',
    configTarget: 'openclaw',
    generatorOutput: outputPath,
    parentConfig,
    model: {
      provider: parentConfig.llm.provider,
      base_url: parentConfig.llm.base_url,
      model_id: parentConfig.llm.model_id,
    },
    roles: { fallback: true, economy: true },
  })

  const checks = []
  try {
    // --- Config file verifiers (always run; they're deterministic) ----------
    const fs = await import('node:fs')
    const raw = fs.readFileSync(outputPath, 'utf-8')
    const parsed = JSON.parse(raw)

    checks.push(check('openclaw.json has mcpServers.fam with auth', () => {
      const famEntry = parsed?.mcpServers?.fam
      if (!famEntry) throw new Error(`mcpServers.fam missing`)
      if (!famEntry.url?.includes(`:${port}`)) throw new Error(`url missing :${port}: ${famEntry.url}`)
      if (!famEntry.headers?.Authorization?.startsWith('Bearer fam_sk_')) {
        throw new Error(`Authorization header missing`)
      }
    }))

    // --- Try runtime inspection commands in priority order ------------------
    const candidates = [
      'openclaw mcp list',
      'openclaw mcp',
      'openclaw --check',
      'openclaw status',
      'openclaw config',
    ]
    let famSeenInRuntime = false
    let bestOutput = ''
    let bestCmd = ''
    for (const cmd of candidates) {
      const r = runAgent(cmd, { timeout: 20_000 })
      const clean = stripAnsi(r.stdout + '\n' + r.stderr)
      if (clean.length > bestOutput.length) {
        bestOutput = clean
        bestCmd = cmd
      }
      if (clean.toLowerCase().includes('fam') && (clean.includes(`:${port}`) || clean.toLowerCase().includes('mcp'))) {
        famSeenInRuntime = true
        bestCmd = cmd
        bestOutput = clean
        break
      }
    }

    checks.push(check(`openclaw CLI reports "fam" (via ${bestCmd || 'none'})`, () => {
      if (!famSeenInRuntime) {
        // If no inspection command works at all, fall back to confirming the binary
        // is at least runnable. Mark this as a softer failure so the user knows.
        const help = runAgent('openclaw --help', { timeout: 10_000 })
        if (help.exitCode !== 0 && !help.stdout && !help.stderr) {
          throw new Error(`openclaw CLI did not respond to any inspection command. Tried: ${candidates.join(', ')}`)
        }
        throw new Error(
          `openclaw has no "mcp list"-equivalent that surfaces "fam" in output.\n` +
          `Best output (${bestCmd}):\n${bestOutput.slice(0, 500)}`,
        )
      }
    }))

    // --- Direct daemon smoke test with openclaw's token --------------------
    if (token) {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      const body = await resp.json()
      const tools = body?.result?.tools || []
      checks.push(check('daemon exposes filesystem tools to OpenClaw token', () => {
        if (tools.filter(t => t.name?.startsWith('filesystem__')).length === 0) {
          throw new Error(`no filesystem__ tools; got ${tools.map(t => t.name).join(', ').slice(0, 300)}`)
        }
      }))
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
