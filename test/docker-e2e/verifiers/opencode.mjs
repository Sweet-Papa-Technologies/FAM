/**
 * verifiers/opencode.mjs -- Runtime verification for OpenCode.
 *
 * OpenCode supports openai_compatible providers natively, so it can actually talk
 * to Ollama for a live gemma4:e2b prompt (when reachable).
 */

import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'opencode',
  display: 'OpenCode',
  install: 'npm i -g opencode-ai',
  binary: 'opencode',
  configPath: '~/.config/opencode/opencode.json',
  supportsLivePrompt: true,
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

export async function verify(parentConfig, llmState) {
  const outputPath = expandHome(meta.configPath)
  const { ctx, port, token } = await setupRuntimeContext({
    agentKey: 'opencode',
    configTarget: 'opencode',
    generatorOutput: outputPath,
    parentConfig,
    model: {
      provider: parentConfig.llm.provider,
      base_url: parentConfig.llm.base_url,
      model_id: parentConfig.llm.model_id,
    },
    roles: { coder: true, task: true },
  })

  const checks = []
  try {
    // --- MCP visibility -----------------------------------------------------
    const mcp = runAgent('opencode mcp list', { timeout: 20_000 })
    const clean = stripAnsi(mcp.stdout + '\n' + mcp.stderr)
    checks.push(check('`opencode mcp list` shows "fam"', () => {
      if (!clean.toLowerCase().includes('fam')) {
        throw new Error(`No "fam" in output. Got:\n${clean.slice(0, 400)}`)
      }
    }))

    // --- Resolved config (opencode.json is source of truth) -----------------
    const fs = await import('node:fs')
    const raw = fs.readFileSync(outputPath, 'utf-8')
    const parsed = JSON.parse(raw)

    checks.push(check('opencode.json has FAM MCP endpoint with auth', () => {
      const famEntry = parsed?.mcp?.fam
      if (!famEntry) throw new Error(`mcp.fam missing from config`)
      if (!famEntry.url?.includes(`:${port}`)) throw new Error(`mcp.fam.url missing port ${port}: ${famEntry.url}`)
      if (!famEntry.headers?.Authorization?.startsWith('Bearer fam_sk_')) {
        throw new Error(`mcp.fam.headers.Authorization missing valid token`)
      }
    }))

    checks.push(check(`opencode.json model references ${parentConfig.llm.model_id}`, () => {
      const model = parsed?.model || ''
      if (!model.includes(parentConfig.llm.model_id)) {
        throw new Error(`model="${model}" does not include "${parentConfig.llm.model_id}"`)
      }
    }))

    // --- Direct daemon cross-check with OpenCode's embedded token -----------
    if (token) {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      const body = await resp.json()
      const tools = body?.result?.tools || []
      checks.push(check('daemon exposes filesystem__* tools to OpenCode token', () => {
        const fsTools = tools.filter(t => t.name?.startsWith('filesystem__'))
        if (fsTools.length === 0) {
          throw new Error(`no filesystem__ tools found; got: ${tools.map(t => t.name).join(', ').slice(0, 300)}`)
        }
      }))
    }

    // --- Live LLM prompt (opt-in, skipped if Ollama unreachable) ------------
    if (llmState?.reachable && llmState?.hasModel) {
      const prompt = runAgent(`opencode run "respond with exactly: alive" --model ollama/${parentConfig.llm.model_id}`, {
        timeout: 90_000,
      })
      const promptOut = stripAnsi(prompt.stdout + prompt.stderr).toLowerCase()
      checks.push(check('opencode run completes with a non-empty response', () => {
        if (!promptOut.trim()) throw new Error(`empty response`)
        if (promptOut.includes('error') && !promptOut.includes('alive')) {
          throw new Error(`error in output: ${promptOut.slice(0, 300)}`)
        }
      }))
    } else {
      console.log(`      skip live opencode run (llm reachable=${llmState?.reachable}, hasModel=${llmState?.hasModel})`)
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
