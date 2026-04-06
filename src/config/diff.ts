/**
 * config/diff.ts -- Compute and format diffs between desired config and applied state.
 *
 * Implements the Terraform-style `plan` output:
 *   + Added items (green)
 *   ~ Changed items (yellow)
 *   - Removed items (red)
 *   (no prefix) Unchanged items
 *
 * The diff logic compares the declared fam.yaml (desired) against the
 * last-applied state.json (current) to determine what `fam apply` would do.
 */

import type {
  FamConfig,
  State,
  PlanDiff,
  SectionDiff,
  DiffItem,
  McpServerConfig,
  HttpServerConfig,
  StdioServerConfig,
} from './types.js'

// ─── Helpers ────────────────────────────────────────────────────

function isHttpServer(server: McpServerConfig): server is HttpServerConfig {
  return 'url' in server
}

function isStdioServer(server: McpServerConfig): server is StdioServerConfig {
  return 'command' in server
}

function emptySectionDiff(): SectionDiff {
  return { added: [], changed: [], removed: [] }
}

// ─── Credential Diff ────────────────────────────────────────────

function diffCredentials(desired: FamConfig, current: State): SectionDiff {
  const diff = emptySectionDiff()
  const desiredNames = new Set(Object.keys(desired.credentials))
  const currentNames = new Set(Object.keys(current.credentials))

  for (const name of desiredNames) {
    if (!currentNames.has(name)) {
      diff.added.push({ name, detail: 'will prompt for value on apply' })
    } else {
      // Check if the type changed
      const desiredCred = desired.credentials[name]
      const currentCred = current.credentials[name]
      if (desiredCred.type !== currentCred.type) {
        diff.changed.push({ name, detail: `type changed: ${currentCred.type} -> ${desiredCred.type}` })
      }
    }
  }

  for (const name of currentNames) {
    if (!desiredNames.has(name)) {
      diff.removed.push({ name, detail: 'will be removed' })
    }
  }

  return diff
}

// ─── MCP Server Diff ────────────────────────────────────────────

function serverSummary(server: McpServerConfig): string {
  if (isHttpServer(server)) {
    return `${server.url} (${server.transport})`
  }
  if (isStdioServer(server)) {
    const cmdParts = [server.command, ...(server.args ?? [])].join(' ')
    return `${cmdParts} (${server.transport})`
  }
  return '(unknown)'
}

function diffServers(desired: FamConfig, current: State): SectionDiff {
  const diff = emptySectionDiff()
  const desiredNames = new Set(Object.keys(desired.mcp_servers))
  const currentNames = new Set(Object.keys(current.mcp_servers))

  for (const name of desiredNames) {
    const server = desired.mcp_servers[name]
    const summary = serverSummary(server)

    if (!currentNames.has(name)) {
      diff.added.push({ name, detail: summary })
    } else {
      const currentServer = current.mcp_servers[name]
      // Compare transport and URL/command
      let changed = false
      const changes: string[] = []

      if (isHttpServer(server) && currentServer.url !== server.url) {
        changed = true
        changes.push(`url: ${currentServer.url ?? '(none)'} -> ${server.url}`)
      }
      if (isStdioServer(server) && currentServer.command !== server.command) {
        changed = true
        changes.push(`command: ${currentServer.command ?? '(none)'} -> ${server.command}`)
      }
      if (server.transport !== currentServer.transport) {
        changed = true
        changes.push(`transport: ${currentServer.transport}`)
      }
      const desiredCred = isHttpServer(server) ? server.credential : (server.credential ?? null)
      if (desiredCred !== currentServer.credential) {
        changed = true
        changes.push(`credential binding changed`)
      }

      if (changed) {
        diff.changed.push({ name, detail: changes.join(', ') })
      }
    }
  }

  for (const name of currentNames) {
    if (!desiredNames.has(name)) {
      diff.removed.push({ name, detail: 'will be removed' })
    }
  }

  return diff
}

// ─── Profile Diff ───────────────────────────────────────────────

function diffProfiles(desired: FamConfig, current: State): SectionDiff {
  const diff = emptySectionDiff()
  const desiredNames = new Set(Object.keys(desired.profiles))
  const currentNames = new Set(Object.keys(current.profiles))

  for (const name of desiredNames) {
    const profile = desired.profiles[name]

    if (!currentNames.has(name)) {
      const servers = profile.allowed_servers.join(', ')
      diff.added.push({ name, detail: `NEW profile (servers: ${servers})` })
    } else {
      const currentProfile = current.profiles[name]
      const desiredServers = [...profile.allowed_servers].sort()
      const currentServers = [...currentProfile.allowed_servers].sort()

      if (JSON.stringify(desiredServers) !== JSON.stringify(currentServers)) {
        const added = desiredServers.filter((s) => !currentProfile.allowed_servers.includes(s))
        const removed = currentServers.filter((s) => !profile.allowed_servers.includes(s))
        const parts: string[] = []
        if (added.length > 0) parts.push(`+ ${added.join(', ')}`)
        if (removed.length > 0) parts.push(`- ${removed.join(', ')}`)
        diff.changed.push({ name, detail: parts.join('; ') })
      }
    }
  }

  for (const name of currentNames) {
    if (!desiredNames.has(name)) {
      diff.removed.push({ name, detail: 'will be removed' })
    }
  }

  return diff
}

// ─── Config File Diff ───────────────────────────────────────────

function diffConfigs(desired: FamConfig, current: State): SectionDiff {
  const diff = emptySectionDiff()

  // Build a set of generator names referenced by profiles
  const desiredGeneratorNames = new Set<string>()
  for (const profile of Object.values(desired.profiles)) {
    desiredGeneratorNames.add(profile.config_target)
  }

  const currentNames = new Set(Object.keys(current.generated_configs))

  for (const genName of desiredGeneratorNames) {
    const generator = desired.generators[genName]
    if (!generator) continue

    if (!currentNames.has(genName)) {
      diff.added.push({ name: genName, detail: `${generator.output} (new file)` })
    } else {
      // Consider it changed if the output path differs
      const currentConfig = current.generated_configs[genName]
      if (currentConfig.path !== generator.output) {
        diff.changed.push({ name: genName, detail: `path: ${currentConfig.path} -> ${generator.output}` })
      }
    }
  }

  for (const name of currentNames) {
    if (!desiredGeneratorNames.has(name)) {
      diff.removed.push({ name, detail: 'will be removed' })
    }
  }

  return diff
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Compare desired config against current applied state.
 *
 * Returns a structured PlanDiff describing what needs to be
 * added, changed, or removed for each config section.
 */
export function computeDiff(desired: FamConfig, current: State): PlanDiff {
  const credentials = diffCredentials(desired, current)
  const servers = diffServers(desired, current)
  const profiles = diffProfiles(desired, current)
  const configs = diffConfigs(desired, current)

  const toAdd =
    credentials.added.length +
    servers.added.length +
    profiles.added.length +
    configs.added.length

  const toChange =
    credentials.changed.length +
    servers.changed.length +
    profiles.changed.length +
    configs.changed.length

  const toRemove =
    credentials.removed.length +
    servers.removed.length +
    profiles.removed.length +
    configs.removed.length

  const hasChanges = toAdd + toChange + toRemove > 0

  return {
    credentials,
    servers,
    profiles,
    configs,
    hasChanges,
    summary: { toAdd, toChange, toRemove },
  }
}

// ─── Formatting ─────────────────────────────────────────────────

function formatSection(title: string, section: SectionDiff): string {
  const lines: string[] = []
  const hasItems =
    section.added.length + section.changed.length + section.removed.length > 0

  // Collect all items: we need to know if there are any items at all in
  // the desired state to decide whether to show the section.
  const allItems: Array<{ prefix: string; item: DiffItem }> = []

  for (const item of section.added) {
    allItems.push({ prefix: '+', item })
  }
  for (const item of section.changed) {
    allItems.push({ prefix: '~', item })
  }
  for (const item of section.removed) {
    allItems.push({ prefix: '-', item })
  }

  if (!hasItems) return ''

  lines.push(`${title}:`)
  for (const { prefix, item } of allItems) {
    const detail = item.detail ? `  (${item.detail})` : ''
    lines.push(`  ${prefix} ${item.name}${detail}`)
  }

  return lines.join('\n')
}

/**
 * Format a PlanDiff as a human-readable Terraform-style plan.
 *
 * Uses `+` / `~` / `-` prefixes for add / change / remove.
 * Ends with a summary line: "Plan: N to add, N to change, N to destroy."
 *
 * If there are no changes, returns "No changes. Infrastructure is up-to-date."
 */
export function formatDiff(diff: PlanDiff): string {
  if (!diff.hasChanges) {
    return 'No changes. Infrastructure is up-to-date.'
  }

  const sections: string[] = []

  const credentialBlock = formatSection('Credential changes', diff.credentials)
  if (credentialBlock) sections.push(credentialBlock)

  const serverBlock = formatSection('MCP server changes', diff.servers)
  if (serverBlock) sections.push(serverBlock)

  const profileBlock = formatSection('Profile changes', diff.profiles)
  if (profileBlock) sections.push(profileBlock)

  const configBlock = formatSection('Config files to update', diff.configs)
  if (configBlock) sections.push(configBlock)

  const { toAdd, toChange, toRemove } = diff.summary
  sections.push(`Plan: ${toAdd} to add, ${toChange} to change, ${toRemove} to destroy.`)

  return sections.join('\n\n')
}
