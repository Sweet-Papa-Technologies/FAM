/**
 * generators/zed.ts — Zed Editor config generator.
 *
 * Produces settings.json with a context_servers entry pointing at the
 * FAM daemon. Output path is platform-dependent:
 *   macOS:  ~/Library/Application Support/Zed/settings.json
 *   Linux:  ~/.config/zed/settings.json
 */

import type { GeneratorInput, GeneratorOutput } from './types.js'
import { buildFamMcpEntry } from './base.js'
import { expandTilde } from '../utils/paths.js'

function defaultZedPath(): string {
  if (process.platform === 'darwin') {
    return expandTilde('~/Library/Application Support/Zed/settings.json')
  }
  return expandTilde('~/.config/zed/settings.json')
}

export function generateZedConfig(input: GeneratorInput): GeneratorOutput {
  const entry = buildFamMcpEntry(input)
  const warnings: string[] = []

  const config = {
    context_servers: {
      fam: {
        source: 'custom',
        url: entry.url,
        headers: entry.headers,
      },
    },
  }

  if (input.models?.default) {
    warnings.push('Zed: Model configuration is managed through Zed settings, not via FAM')
  }

  const outputPath = input.profile.config_target
    ? expandTilde(input.profile.config_target)
    : defaultZedPath()

  return {
    path: outputPath,
    content: JSON.stringify(config, null, 2) + '\n',
    format: 'json',
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
