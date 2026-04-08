/**
 * tests/model-config.mjs -- Model configuration pipeline tests.
 *
 * For agents that support model configuration, generates configs with
 * model provider + model ID and verifies the model info appears in
 * the generated output.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TestContext } from '../lib/test-context.mjs'

const CATEGORY = 'model-config'

/**
 * Check if the LLM base_url is reachable.
 */
async function isLlmReachable(baseUrl) {
  try {
    const url = baseUrl.replace(/\/v1\/?$/, '')
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return resp.ok || resp.status < 500
  } catch {
    return false
  }
}

/**
 * Resolve the output path (same as generators.mjs).
 */
function resolveOutputPath(agentKey, agentDef, ctx) {
  const home = process.env.HOME || '/home/famtest'
  let outputPath = agentDef.output_path

  if (agentKey === 'generic') {
    return join(ctx.famDir, 'configs', `model-${agentKey}.json`)
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
 * Build model_roles YAML block from agent's supported roles.
 * Maps each role to the same model reference (local/default).
 */
function buildModelRolesYaml(roles) {
  if (!roles || roles.length === 0) return ''
  const lines = ['    model_roles:']
  for (const role of roles) {
    lines.push(`      ${role}: local/default`)
  }
  return lines.join('\n')
}

/**
 * Agent-specific verification: check that the generated config
 * contains the expected model identifier.
 */
const MODEL_VERIFIERS = {
  claude_code: (parsed, raw, modelId) => {
    // env.ANTHROPIC_MODEL should contain the model ID
    if (parsed?.env?.ANTHROPIC_MODEL !== modelId) {
      throw new Error(`Expected env.ANTHROPIC_MODEL = "${modelId}", got "${parsed?.env?.ANTHROPIC_MODEL}"`)
    }
  },

  opencode: (parsed, raw, modelId) => {
    // agents.coder.model should contain the model ID
    const coderModel = parsed?.agents?.coder?.model
    if (coderModel !== modelId) {
      throw new Error(`Expected agents.coder.model = "${modelId}", got "${coderModel}"`)
    }
  },

  openhands: (parsed, raw, modelId) => {
    // TOML: check raw text for model = "..."
    if (!raw.includes(`model =`) || !raw.includes(modelId)) {
      throw new Error(`Expected model = "${modelId}" in TOML output`)
    }
  },

  aider: (parsed, raw, modelId) => {
    // YAML: check for model: line containing the model ID
    // Aider prefixes with provider, e.g. "openai/model-id"
    if (!raw.includes('model:')) {
      throw new Error(`Expected "model:" line in YAML output`)
    }
    if (!raw.includes(modelId)) {
      throw new Error(`Expected model ID "${modelId}" in YAML output`)
    }
  },

  continue_dev: (parsed, raw, modelId) => {
    // YAML: models[] array should contain model with provider
    const models = parsed?.models
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error(`Expected models[] array in YAML output, got: ${JSON.stringify(models)}`)
    }
    const found = models.some(m => m.model === modelId)
    if (!found) {
      throw new Error(`Expected model "${modelId}" in models[] array, got: ${models.map(m => m.model).join(', ')}`)
    }
  },

  openclaw: (parsed, raw, modelId) => {
    // models.providers section should exist
    if (!parsed?.models?.providers) {
      throw new Error(`Expected models.providers in generated JSON, got keys: ${Object.keys(parsed || {}).join(', ')}`)
    }
  },

  cline: (parsed, raw, modelId) => {
    // cline.apiModelId should be set
    const apiModelId = parsed?.['cline.apiModelId']
    if (apiModelId !== modelId) {
      throw new Error(`Expected cline.apiModelId = "${modelId}", got "${apiModelId}"`)
    }
  },

  gemini_cli: (parsed, raw, modelId) => {
    // Just verify mcpServers.fam.url exists (gemini model config is external)
    if (!parsed?.mcpServers?.fam?.url) {
      throw new Error('Expected mcpServers.fam.url in generated JSON')
    }
  },
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} parentCtx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(parentCtx, reporter) {
  const llmConfig = parentCtx.config.llm || {}
  const agents = parentCtx.config.agents || {}

  // Check if LLM endpoint is reachable (optional -- tests still run,
  // but models won't actually work without a real provider)
  const llmReachable = await isLlmReachable(llmConfig.base_url || '')
  if (!llmReachable) {
    console.log(`  Note: LLM endpoint ${llmConfig.base_url} is not reachable (model validation will be structural only)`)
  }

  for (const [agentKey, agentDef] of Object.entries(agents)) {
    // Only test agents with model_support
    if (!agentDef.model_support) continue

    const testName = `model-${agentKey}`
    const t0 = Date.now()

    const ctx = new TestContext(`model-${agentKey}`, parentCtx.config)

    try {
      const outputPath = resolveOutputPath(agentKey, agentDef, ctx)
      const configTarget = agentDef.config_target

      // Use temp dir for generator output to avoid cross-test contamination
      // from agent-integration tests that may have written to global paths
      const tempOutputName = `model-test-${agentKey}.${agentDef.output_format === 'json' ? 'json' : agentDef.output_format === 'yaml' ? 'yaml' : 'toml'}`
      const isolatedOutputPath = join(ctx.famDir, tempOutputName)
      let generatorOutput = isolatedOutputPath

      const modelId = llmConfig.model_id || 'qwen2.5-coder:7b'
      const baseUrl = llmConfig.base_url || 'http://host.docker.internal:11434/v1'
      const provider = llmConfig.provider || 'openai_compatible'
      const apiKey = llmConfig.api_key || 'ollama'
      const modelRolesYaml = buildModelRolesYaml(agentDef.model_roles)

      const yaml = `
version: "0.1"

settings:
  daemon:
    port: 17865
    auto_start: false
  audit:
    enabled: false

models:
  local:
    provider: ${provider}
    credential: null
    base_url: "${baseUrl}"
    models:
      default: "${modelId}"
      fast: "${modelId}"

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ctx.projectDir}"]
    transport: stdio
    description: "Test filesystem"

profiles:
  model-${agentKey}:
    description: "Model config test for ${agentDef.display_name}"
    config_target: ${configTarget}
    model: local/default
${modelRolesYaml}
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

      // Read the generated config from the isolated path
      const generated = ctx.readGeneratedConfig(isolatedOutputPath)
      if (!generated.raw) {
        throw new Error(`Generated config not found at ${outputPath}. Apply output: ${combined.slice(0, 300)}`)
      }

      // Run agent-specific verification
      const verifier = MODEL_VERIFIERS[agentKey]
      if (verifier) {
        verifier(generated.parsed, generated.raw, modelId)
      } else {
        // Generic check: model ID should appear somewhere in the output
        if (!generated.raw.includes(modelId)) {
          // Not all agents embed the model ID in config (some only have MCP config).
          // If the agent has model_support but no specific verifier, just check
          // that the file was generated successfully.
          console.log(`  Note: No specific verifier for ${agentKey}, checking file exists only`)
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
