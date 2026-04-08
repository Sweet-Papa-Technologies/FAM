#!/usr/bin/env node

/**
 * runner.mjs -- Main orchestrator for the FAM Docker E2E test suite.
 *
 * Reads e2e-config.yaml, optionally filters to a single category,
 * runs each test module in sequence, and produces a structured report.
 *
 * Usage:
 *   node test/docker-e2e/runner.mjs              # run all categories
 *   node test/docker-e2e/runner.mjs core-cli      # run only core-cli
 *   node test/docker-e2e/runner.mjs vault          # run only vault
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { Reporter } from './lib/reporter.mjs'
import { TestContext } from './lib/test-context.mjs'

// ── Parse config ──────────────────────────────────────────────────────

const configPath = process.env.E2E_CONFIG || 'test/docker-e2e/e2e-config.yaml'
const config = parseYaml(readFileSync(configPath, 'utf-8'))

// Override LLM URL from env if set
if (process.env.E2E_LLM_URL) {
  config.llm.base_url = process.env.E2E_LLM_URL
}

// ── Parse CLI args ────────────────────────────────────────────────────

const args = process.argv.slice(2)
const categoryFilter = args.find(a => !a.startsWith('-'))
const categories = categoryFilter ? [categoryFilter] : config.categories

// ── Category module map ───────────────────────────────────────────────

const CATEGORY_MODULES = {
  'core-cli': './tests/core-cli.mjs',
  'daemon': './tests/daemon.mjs',
  'generators': './tests/generators.mjs',
  'vault': './tests/vault.mjs',
  'agent-integration': './tests/agent-integration.mjs',
  'model-config': './tests/model-config.mjs',
}

// ── Run ───────────────────────────────────────────────────────────────

const reporter = new Reporter()

console.log(`\nFAM Docker E2E Test Suite`)
console.log(`Node ${process.version} | Categories: ${categories.join(', ')}\n`)

for (const category of categories) {
  const modPath = CATEGORY_MODULES[category]
  if (!modPath) {
    console.log(`Unknown category: ${category}`)
    continue
  }

  console.log(`--- ${category} ---`)
  const mod = await import(modPath)
  const ctx = new TestContext(category, config)

  try {
    await mod.run(ctx, reporter)
  } catch (err) {
    reporter.fail(category, 'category-setup', err)
  } finally {
    ctx.cleanup()
  }

  console.log()
}

reporter.finalize('/tmp/fam-e2e-results.json')
