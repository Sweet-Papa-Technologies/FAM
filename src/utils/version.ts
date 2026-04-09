/**
 * utils/version.ts — Single source of truth for the FAM version.
 *
 * Reads the version from package.json at import time.
 * All other files should import FAM_VERSION from here
 * instead of hardcoding version strings.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadVersion(): string {
  // Walk up from this file to find package.json
  // In dist: dist/index.js → package.json is at ../package.json
  // In src:  src/utils/version.ts → package.json is at ../../package.json
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(thisDir, '..', 'package.json'),       // dist/
    join(thisDir, '..', '..', 'package.json'),  // src/utils/
  ]

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8')
      const pkg = JSON.parse(raw)
      if (pkg.version) return pkg.version
    } catch {
      // Try next candidate
    }
  }

  return '0.0.0' // Fallback — should never happen
}

export const FAM_VERSION = loadVersion()
