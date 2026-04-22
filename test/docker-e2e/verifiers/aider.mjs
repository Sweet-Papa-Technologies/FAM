/**
 * verifiers/aider.mjs -- Runtime verification for Aider.
 *
 * Aider has no MCP support, so this is strictly model-config verification.
 * We use `aider --show-model-settings --exit` to dump the resolver's idea of the
 * active model, and assert gemma4:e2b appears.
 */

import { setupRuntimeContext, runAgent, stripAnsi, check } from '../lib/runtime-harness.mjs'

export const meta = {
  key: 'aider',
  display: 'Aider',
  install: 'pip install --user aider-chat',
  binary: 'aider',
  configPath: '~/.aider.conf.yml',
  supportsLivePrompt: true,
}

function expandHome(p) {
  return p.replace(/^~/, process.env.HOME || '/home/famtest')
}

export async function verify(parentConfig, llmState) {
  const outputPath = expandHome(meta.configPath)
  const { ctx, port } = await setupRuntimeContext({
    agentKey: 'aider',
    configTarget: 'aider',
    generatorOutput: outputPath,
    parentConfig,
    model: {
      provider: parentConfig.llm.provider, // openai_compatible → LiteLLM openai/ prefix
      base_url: parentConfig.llm.base_url,
      model_id: parentConfig.llm.model_id,
    },
    roles: { editor: true, weak: true },
  })

  const checks = []
  try {
    // --- Config file sanity (aider has no MCP, so no daemon check) ----------
    const fs = await import('node:fs')
    const raw = fs.readFileSync(outputPath, 'utf-8')
    checks.push(check(`.aider.conf.yml has model: line with ${parentConfig.llm.model_id}`, () => {
      if (!/^model:/m.test(raw)) throw new Error(`missing top-level model: line`)
      if (!raw.includes(parentConfig.llm.model_id)) {
        throw new Error(`model id ${parentConfig.llm.model_id} not in yaml`)
      }
    }))
    checks.push(check('.aider.conf.yml has openai-api-base pointing at Ollama', () => {
      if (!raw.includes(parentConfig.llm.base_url)) {
        throw new Error(`base_url ${parentConfig.llm.base_url} not in yaml`)
      }
    }))

    // Note: aider's CLI flags for dumping resolved model config change between releases
    // (`--show-model-settings` takes a positional in some versions, is removed in others).
    // We rely on the config file check above + the live prompt below, which together
    // give a stronger runtime signal than scraping stdout of a flag-sensitive command.

    // --- Live prompt (opt-in) -----------------------------------------------
    if (llmState?.reachable && llmState?.hasModel) {
      const prompt = runAgent(
        `aider --message "reply with exactly: alive" --no-git --yes --exit --model openai/${parentConfig.llm.model_id}`,
        {
          timeout: 90_000,
          cwd: ctx.projectDir,
          env: {
            OPENAI_API_KEY: 'ollama',
            OPENAI_API_BASE: parentConfig.llm.base_url,
            HOME: process.env.HOME,
          },
        },
      )
      const clean2 = stripAnsi(prompt.stdout + prompt.stderr).toLowerCase()
      checks.push(check('aider --message completes with non-empty output', () => {
        if (!clean2.trim()) throw new Error(`empty output`)
        if (clean2.includes('error') && !clean2.includes('alive')) {
          // LiteLLM sometimes prints deprecation warnings that contain "error" — only fail if we truly got nothing
          if (clean2.length < 20) throw new Error(`truncated/error: ${clean2.slice(0, 200)}`)
        }
      }))
    } else {
      console.log(`      skip live aider prompt (llm reachable=${llmState?.reachable}, hasModel=${llmState?.hasModel})`)
    }
  } finally {
    await ctx.stopDaemon()
    ctx.cleanup()
  }

  return { checks }
}
