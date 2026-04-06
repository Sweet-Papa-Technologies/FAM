/**
 * config/resolve.ts -- Environment variable resolution for fam.yaml values.
 *
 * Before Zod validation, all string values in the parsed YAML are walked
 * and `${VAR_NAME}` patterns are replaced with the corresponding
 * `process.env[VAR_NAME]` value. If the env var is not set, the
 * placeholder is left as-is (it may be resolved at apply time).
 */

import { expandTilde } from '../utils/paths.js'

/** Pattern matching `${VAR_NAME}` in strings. */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Replace `${VAR_NAME}` references in a single string with their
 * `process.env` values. Unset variables are left untouched.
 */
function resolveString(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (match, varName: string) => {
    const envValue = process.env[varName]
    return envValue !== undefined ? envValue : match
  })
}

/**
 * Recursively walk an object/array and replace `${VAR}` patterns
 * in all string values with their `process.env` counterparts.
 *
 * Non-string primitives (numbers, booleans, null) are returned as-is.
 * Arrays and objects are traversed recursively with new references
 * (the original object is not mutated).
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveString(obj)
  }

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = resolveEnvVars(value)
  }
  return result
}

/**
 * Expand a leading `~` in a path to the user's home directory.
 * Re-exported from utils/paths for convenience within the config module.
 */
export { expandTilde }
