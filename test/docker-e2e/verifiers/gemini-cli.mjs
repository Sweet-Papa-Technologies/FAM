/**
 * verifiers/gemini-cli.mjs -- Runtime verification for Google Gemini CLI.
 *
 * Gemini CLI only speaks Google's format, so like Claude Code it cannot make
 * a live call to Ollama. We verify MCP visibility via `gemini mcp list` and
 * confirm the settings.json shape.
 */

import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'gemini_cli',
  display: 'Gemini CLI',
  install: 'npm i -g @google/gemini-cli',
  binary: 'gemini',
  configPath: '~/.gemini/settings.json',
  supportsLivePrompt: false,
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

export async function verify(parentConfig, llmState) {
  const outputPath = expandHome(meta.configPath)
  const { ctx, port, token } = await setupRuntimeContext({
    agentKey: 'gemini_cli',
    configTarget: 'gemini_cli',
    generatorOutput: outputPath,
    parentConfig,
    // Declare as google so the generator writes the model.name field; base_url/model
    // is Ollama's but we don't make a live call.
    model: {
      provider: 'google',
      base_url: parentConfig.llm.base_url,
      model_id: parentConfig.llm.model_id,
    },
  })

  const checks = []
  try {
    // Gemini CLI has a quirk: when stdout is piped (as happens under execSync
    // with stdio:"pipe"), it swallows ALL its output. Shell-redirecting to a
    // file keeps the TTY-detection happy. We also need --debug so the resolver
    // emits the "Configured MCP servers" section.
    const tmpOut = `/tmp/gemini-out-${Date.now()}.log`
    runAgent(`gemini mcp list --debug > ${tmpOut} 2>&1`, {
      timeout: 20_000,
      env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'stub-key-for-mcp-list' },
    })
    const fsSync = await import('node:fs')
    const clean = stripAnsi(fsSync.existsSync(tmpOut) ? fsSync.readFileSync(tmpOut, 'utf-8') : '')
    try { fsSync.rmSync(tmpOut, { force: true }) } catch { /* noop */ }
    checks.push(check('`gemini mcp list` mentions "fam"', () => {
      if (!/fam[:\s]/i.test(clean)) {
        throw new Error(`No "fam" in output. Got:\n${clean.slice(0, 600)}`)
      }
    }))

    // --- Config file structure ---------------------------------------------
    const fs = await import('node:fs')
    const raw = fs.readFileSync(outputPath, 'utf-8')
    const parsed = JSON.parse(raw)

    checks.push(check('settings.json has mcpServers.fam with auth header', () => {
      const famEntry = parsed?.mcpServers?.fam
      if (!famEntry) throw new Error(`mcpServers.fam missing`)
      if (!famEntry.url?.includes(`:${port}`)) throw new Error(`missing port ${port} in url: ${famEntry.url}`)
      if (!famEntry.headers?.Authorization?.startsWith('Bearer fam_sk_')) {
        throw new Error(`missing/invalid Authorization header`)
      }
    }))

    checks.push(check(`settings.json has model.name=${parentConfig.llm.model_id}`, () => {
      if (parsed?.model?.name !== parentConfig.llm.model_id) {
        throw new Error(`Got model.name=${parsed?.model?.name}, want ${parentConfig.llm.model_id}`)
      }
    }))

    // --- Direct daemon smoke test ------------------------------------------
    if (token) {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      const body = await resp.json()
      const tools = body?.result?.tools || []
      checks.push(check('daemon exposes filesystem tools to Gemini token', () => {
        if (tools.filter(t => t.name?.startsWith('filesystem__')).length === 0) {
          throw new Error(`no filesystem__ tools; got: ${tools.map(t => t.name).join(', ').slice(0, 300)}`)
        }
      }))
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
