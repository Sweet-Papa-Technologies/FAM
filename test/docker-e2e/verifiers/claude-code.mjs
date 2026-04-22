/**
 * verifiers/claude-code.mjs -- Runtime verification for Anthropic's Claude Code CLI.
 *
 * Claude Code is Anthropic-only — it cannot talk to Ollama's OpenAI-compatible
 * endpoint unless a translation proxy is in front. So the model block is declared
 * with provider=anthropic against the Ollama URL; Claude Code will read the
 * resolved env.ANTHROPIC_MODEL from ~/.claude/settings.json, and `claude mcp list`
 * is what we primarily rely on to confirm runtime visibility.
 */

import { join } from 'node:path'
import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'claude_code',
  display: 'Claude Code',
  install: 'npm i -g @anthropic-ai/claude-code',
  binary: 'claude',
  // Primary MCP config — the file `claude mcp list` reads from.
  configPath: '~/.claude.json',
  // Secondary file containing the env block (ANTHROPIC_MODEL etc.) —
  // cleaned separately in the verifier so stale tokens don't survive across runs.
  secondaryConfigPath: '~/.claude/settings.json',
  supportsLivePrompt: false, // anthropic-only, no Ollama path
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

export async function verify(parentConfig, llmState) {
  const outputPath = expandHome(meta.configPath)
  const { ctx, port, token, profileName } = await setupRuntimeContext({
    agentKey: 'claude_code',
    configTarget: 'claude_code',
    generatorOutput: outputPath,
    parentConfig,
    // Claude Code will accept an Anthropic-shaped base_url but skip model config
    // if provider is not anthropic. We declare it as anthropic so the env block
    // is written, even though the URL points at Ollama (model verification is
    // structural, not live).
    model: {
      provider: 'anthropic',
      base_url: parentConfig.llm.base_url,
      model_id: parentConfig.llm.model_id,
    },
    roles: { sonnet_tier: true, opus_tier: true, haiku_tier: true },
  })

  const checks = []
  try {
    // --- MCP visibility -----------------------------------------------------
    // Claude Code 2.x reads MCP config from ~/.claude.json (top-level mcpServers,
    // `type: "http"`). FAM's claude-code generator now targets this file directly.
    const mcp = runAgent('claude mcp list', { timeout: 15_000 })
    const clean = stripAnsi(mcp.stdout + '\n' + mcp.stderr)

    checks.push(check('`claude mcp list` runs and mentions "fam"', () => {
      if (!clean.toLowerCase().includes('fam')) {
        throw new Error(`No "fam" in output. stdout:\n${clean.slice(0, 400)}`)
      }
    }))

    checks.push(check('`claude mcp list` shows the daemon URL', () => {
      if (!clean.includes(`:${port}`) && !clean.includes('127.0.0.1') && !clean.includes('localhost')) {
        throw new Error(`Expected daemon URL in output. Got:\n${clean.slice(0, 400)}`)
      }
    }))

    // --- claude mcp get for detail ------------------------------------------
    const details = runAgent('claude mcp get fam', { timeout: 15_000 })
    const detailClean = stripAnsi(details.stdout + '\n' + details.stderr)
    checks.push(check('`claude mcp get fam` succeeds or confirms connection', () => {
      const lc = detailClean.toLowerCase()
      const connected = lc.includes('connected') || lc.includes('✔') || lc.includes('ok') || lc.includes(`:${port}`)
      if (!connected && details.exitCode !== 0) {
        throw new Error(`Output did not indicate connection:\n${detailClean.slice(0, 400)}`)
      }
    }))

    // --- Config files echo the model we asked for ---------------------------
    const fs = await import('node:fs')
    const mainRaw = fs.readFileSync(outputPath, 'utf-8')
    const mainParsed = JSON.parse(mainRaw)
    checks.push(check('~/.claude.json mcpServers.fam.type is "http"', () => {
      if (mainParsed?.mcpServers?.fam?.type !== 'http') {
        throw new Error(`Got type=${mainParsed?.mcpServers?.fam?.type}, want "http"`)
      }
    }))

    const settingsPath = expandHome(meta.secondaryConfigPath)
    checks.push(check('~/.claude/settings.json has ANTHROPIC_MODEL=gemma4:e2b', () => {
      if (!fs.existsSync(settingsPath)) throw new Error(`secondary file not written at ${settingsPath}`)
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      if (settings?.env?.ANTHROPIC_MODEL !== parentConfig.llm.model_id) {
        throw new Error(`Got env.ANTHROPIC_MODEL=${settings?.env?.ANTHROPIC_MODEL}, want ${parentConfig.llm.model_id}`)
      }
    }))

    // --- Direct daemon smoke test (cross-check the token embedded in config) -
    if (token) {
      const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      const body = await resp.json()
      const tools = body?.result?.tools || []
      checks.push(check('daemon tools/list exposes filesystem__* tools via the claude-code token', () => {
        const fsTools = tools.filter(t => t.name?.startsWith('filesystem__'))
        if (fsTools.length === 0) {
          throw new Error(`No filesystem__ tools in daemon response. Got: ${tools.map(t => t.name).join(', ').slice(0, 300)}`)
        }
      }))
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
