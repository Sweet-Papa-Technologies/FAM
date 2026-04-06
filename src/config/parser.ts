/**
 * config/parser.ts -- Parse and validate fam.yaml.
 *
 * Reads a YAML file from disk, resolves `${ENV_VAR}` references,
 * validates the result against the Zod schema, and returns a
 * strongly-typed FamConfig object.
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { ZodError } from 'zod'

import { ConfigError } from '../utils/errors.js'
import { FamConfigSchema } from './schema.js'
import { resolveEnvVars } from './resolve.js'
import type { FamConfig } from './types.js'

/**
 * Parse and validate a fam.yaml configuration file.
 *
 * 1. Read the file from disk
 * 2. Parse YAML into a plain object
 * 3. Resolve `${ENV_VAR}` patterns in string values
 * 4. Validate with the Zod schema (applies defaults)
 * 5. Return a typed FamConfig
 *
 * @param yamlPath - Absolute or relative path to fam.yaml
 * @returns Validated and typed FamConfig
 * @throws ConfigError on file-not-found, YAML parse failure, or schema violation
 */
export function parseConfig(yamlPath: string): FamConfig {
  // Step 1: Read the file
  let raw: string
  try {
    raw = readFileSync(yamlPath, 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError('CONFIG_FILE_NOT_FOUND', `Cannot read config file: ${yamlPath}\n${msg}`)
  }

  // Step 2: Parse YAML
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConfigError('CONFIG_YAML_PARSE_ERROR', `Invalid YAML in ${yamlPath}\n${msg}`)
  }

  // Step 3: Resolve env vars before validation
  const resolved = resolveEnvVars(parsed)

  // Step 4: Validate with Zod
  let config: FamConfig
  try {
    config = FamConfigSchema.parse(resolved) as FamConfig
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
          return `  - ${path}: ${issue.message}`
        })
        .join('\n')
      throw new ConfigError(
        'CONFIG_VALIDATION_ERROR',
        `Config validation failed for ${yamlPath}:\n${details}`,
      )
    }
    throw err
  }

  return config
}
