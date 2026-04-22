/**
 * runtime-harness.mjs -- Shared harness for runtime-verification tests.
 *
 * Each verifier follows the same lifecycle:
 *
 *   1. pickPort()                — claim a unique port
 *   2. cleanGlobalConfig(paths)  — wipe the agent's global config so we start clean
 *   3. writeFamYaml()            — declare FAM config with MCP + model
 *   4. fam apply --yes           — creates sessions.json + writes agent config file
 *      (contains a live session token embedded in the Authorization header)
 *   5. startDaemon()             — reads sessions.json, listens on the port
 *   6. runAgentCommands()        — verifier-defined assertions against the real agent
 *   7. cleanup()                 — stop daemon + remove temp dir
 */

import { execSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { TestContext } from './test-context.mjs'

/** Monotonically increasing port allocator. Avoids collisions between sequential agent tests. */
let _nextPort = 17900
export function nextPort() {
  return _nextPort++
}

/**
 * Remove a list of global config paths so each runtime test starts from a clean slate.
 * Takes absolute paths (already tilde-expanded). Safe no-op if the file doesn't exist.
 *
 * @param {string[]} paths
 */
export function cleanGlobalConfig(paths) {
  for (const p of paths) {
    try {
      if (existsSync(p)) rmSync(p, { force: true })
    } catch {
      // best effort — if we can't remove it, the agent will overwrite it anyway
    }
  }
}

/**
 * Run `command` with a timeout and return { ok, stdout, stderr, exitCode }.
 * Does NOT throw on non-zero exit — verifiers assert on content instead.
 *
 * @param {string} command
 * @param {{ timeout?: number, env?: object, cwd?: string }} [opts]
 */
export function runAgent(command, opts = {}) {
  const { timeout = 30_000, env = {}, cwd } = opts
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    return { ok: true, stdout, stderr: '', exitCode: 0 }
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message ?? '',
      exitCode: err.status ?? 1,
    }
  }
}

/**
 * Strip ANSI escape codes so grep/assertions see plain text.
 */
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return (s || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

/**
 * Check whether an LLM endpoint is reachable. Used to decide whether to run live prompts.
 *
 * @param {string} baseUrl  e.g. http://host.docker.internal:11434/v1
 * @param {string} [modelId] when provided, also verify the model is pulled
 * @returns {Promise<{ reachable: boolean, hasModel: boolean, reason?: string }>}
 */
export async function probeLlm(baseUrl, modelId) {
  if (!baseUrl) return { reachable: false, hasModel: false, reason: 'no base_url' }
  try {
    const root = baseUrl.replace(/\/v1\/?$/, '')
    // Ollama exposes /api/tags; OpenAI-compat servers expose /v1/models.
    const [tags, models] = await Promise.allSettled([
      fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) }),
    ])

    const reachable =
      (tags.status === 'fulfilled' && tags.value.ok) ||
      (models.status === 'fulfilled' && models.value.ok)
    if (!reachable) return { reachable: false, hasModel: false, reason: 'connection failed' }

    if (!modelId) return { reachable: true, hasModel: false }

    let body = ''
    if (tags.status === 'fulfilled' && tags.value.ok) {
      body = await tags.value.text()
    } else if (models.status === 'fulfilled' && models.value.ok) {
      body = await models.value.text()
    }
    return { reachable: true, hasModel: body.includes(modelId) }
  } catch (err) {
    return { reachable: false, hasModel: false, reason: err.message }
  }
}

/**
 * Build a canonical fam.yaml for a runtime-verification test.
 *
 * The generated YAML declares one filesystem MCP server (so we have real tools to enumerate),
 * one profile bound to the agent's config_target, optional model configuration, and a
 * generator output path. The port is the unique per-test port from nextPort().
 *
 * @param {object} args
 * @param {string} args.profileName
 * @param {string} args.configTarget
 * @param {number} args.port
 * @param {string} args.projectDir     - used as the filesystem server root
 * @param {string} [args.generatorOutput] - override the generator output path (absolute)
 * @param {object} [args.model]        - when set, adds a models: block and profile.model
 * @param {object} [args.roles]        - model_roles map: role -> 'local/default'
 */
export function buildFamYaml({
  profileName,
  configTarget,
  port,
  projectDir,
  generatorOutput,
  model,
  roles,
}) {
  const modelsBlock = model
    ? `
models:
  local:
    provider: ${model.provider}
    credential: null
    base_url: "${model.base_url}"
    models:
      default: "${model.model_id}"
      fast: "${model.model_id}"
`
    : ''

  const profileModelLine = model ? '    model: local/default' : ''
  const rolesBlock = roles && Object.keys(roles).length > 0
    ? ['    model_roles:', ...Object.keys(roles).map(r => `      ${r}: local/default`)].join('\n')
    : ''

  const generatorOutputLine = generatorOutput ? `    output: ${generatorOutput}` : ''

  return `version: "0.1"

settings:
  daemon:
    port: ${port}
    auto_start: false
  audit:
    enabled: true

${modelsBlock}
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${projectDir}"]
    transport: stdio
    description: "Test filesystem server"

profiles:
  ${profileName}:
    description: "Runtime verification profile"
    config_target: ${configTarget}
${profileModelLine}
${rolesBlock}
    allowed_servers: [filesystem]

generators:
  ${configTarget}:
${generatorOutputLine}
    format: ${configTarget}

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile"
  list_servers:
    enabled: true
    description: "List MCP servers"
  health:
    enabled: true
    description: "Daemon health"
`
}

/**
 * Set up a full runtime test context: write yaml, apply, start daemon.
 * Returns { ctx, port, token } — verifier is responsible for calling stopDaemon() + ctx.cleanup().
 *
 * @param {object} args
 * @param {string} args.agentKey
 * @param {string} args.configTarget
 * @param {string} args.generatorOutput
 * @param {object} args.parentConfig  - the parsed e2e-config.yaml
 * @param {object} [args.model]       - model config (passed to buildFamYaml)
 * @param {object} [args.roles]       - model roles
 */
export async function setupRuntimeContext({
  agentKey,
  configTarget,
  generatorOutput,
  parentConfig,
  model,
  roles,
}) {
  const ctx = new TestContext(`rt-${agentKey}`, parentConfig)
  const port = nextPort()
  const profileName = `rt-${agentKey}`

  const yaml = buildFamYaml({
    profileName,
    configTarget,
    port,
    projectDir: ctx.projectDir,
    generatorOutput,
    model,
    roles,
  })
  ctx.writeFamYaml(yaml)

  const applyResult = ctx.fam('apply --yes')
  if (applyResult.exitCode !== 0) {
    throw new Error(`fam apply failed (exit ${applyResult.exitCode}): ${(applyResult.stderr || applyResult.stdout).slice(0, 400)}`)
  }

  await ctx.startDaemon(port)

  // Read token out of the generated config so verifiers can hit the daemon directly.
  let token = null
  if (existsSync(generatorOutput)) {
    const content = readFileSync(generatorOutput, 'utf-8')
    const m = content.match(/fam_sk_[a-z]{3}_[0-9a-f]{64}/)
    token = m ? m[0] : null
  }

  return { ctx, port, token, profileName, applyOutput: applyResult.stdout + applyResult.stderr }
}

/**
 * Run a sub-assertion inside a verifier. Catches throw, logs the failure inline.
 * Returns true on pass, false on fail. Keeps the verifier readable.
 */
export function check(label, fn) {
  try {
    fn()
    console.log(`      ok  ${label}`)
    return { pass: true, label }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`      FAIL ${label}: ${msg}`)
    return { pass: false, label, error: msg }
  }
}
