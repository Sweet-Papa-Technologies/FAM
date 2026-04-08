#!/usr/bin/env node
/**
 * check-native-modules.mjs — Detect and fix native module version mismatches.
 *
 * Native modules like better-sqlite3 compile against a specific Node.js
 * version (NODE_MODULE_VERSION). If the user switches Node versions (e.g.,
 * via nvm), the compiled binary won't load. This script detects that and
 * auto-rebuilds.
 *
 * Runs before `npm test` and can be called manually.
 */

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const REQUIRED_MAJOR = 22

// ─── Check Node Version ─────────────────────────────────────────

const major = parseInt(process.versions.node.split('.')[0], 10)
if (major < REQUIRED_MAJOR) {
  console.error(`\n  FAM requires Node.js >= ${REQUIRED_MAJOR} (you have ${process.version}).`)
  console.error('  Run: nvm use 22\n')
  process.exit(1)
}

// ─── Check Native Module Compatibility ──────────────────────────

const NATIVE_MODULES = ['better-sqlite3']

let needsRebuild = false

for (const mod of NATIVE_MODULES) {
  try {
    // require() loads the JS wrapper; we must actually use the native binding
    // to trigger NODE_MODULE_VERSION mismatch errors.
    const require = createRequire(import.meta.url)
    const Module = require(mod)
    // Instantiate to force native binary load
    const db = new Module(':memory:')
    db.close()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NODE_MODULE_VERSION') || msg.includes('was compiled against') || msg.includes('ERR_DLOPEN_FAILED')) {
      console.log(`  Native module "${mod}" was compiled for a different Node.js version.`)
      needsRebuild = true
    } else if (msg.includes('Cannot find module') || msg.includes('Could not locate the bindings')) {
      console.log(`  Native module "${mod}" binary not found.`)
      needsRebuild = true
    }
    // Other errors (e.g., missing optional dep) are fine — skip
  }
}

if (needsRebuild) {
  const projectRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '')
  const require = createRequire(import.meta.url)

  // Delete stale build artifacts so npm rebuild compiles fresh
  for (const mod of NATIVE_MODULES) {
    try {
      const modDir = dirname(require.resolve(`${mod}/package.json`))
      const buildDir = join(modDir, 'build')
      rmSync(buildDir, { recursive: true, force: true })
    } catch {
      // Module dir not found — rebuild will handle it
    }
  }

  console.log(`  Rebuilding native modules for Node.js ${process.version}...`)
  try {
    execSync(`npm rebuild ${NATIVE_MODULES.join(' ')}`, {
      stdio: 'inherit',
      cwd: projectRoot,
    })
    console.log('  Native modules rebuilt successfully.\n')
  } catch {
    console.error('  Failed to rebuild native modules. Try running manually:')
    console.error(`    npm rebuild ${NATIVE_MODULES.join(' ')}\n`)
    process.exit(1)
  }
}
