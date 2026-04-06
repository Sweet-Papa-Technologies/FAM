/**
 * config/types.ts — All configuration-related type definitions.
 *
 * These types are derived from the Zod schema in DESIGN.md Section 5.1.
 * The actual Zod schema will be built in config/schema.ts (Step 1).
 * For now, we define the inferred types manually so that parallel agents
 * can code against them immediately.
 */

// ─── Credential Config Types ───────────────────────────────────────

export interface ApiKeyCredConfig {
  type: 'api_key'
  description: string
  env_var?: string
  rotate_after_days?: number
}

export interface OAuthCredConfig {
  type: 'oauth2'
  description: string
  provider: string
  client_id: string
  scopes: string[]
}

export type CredentialConfig = ApiKeyCredConfig | OAuthCredConfig

// ─── MCP Server Config Types ───────────────────────────────────────

export interface HttpServerConfig {
  url: string
  transport: 'sse' | 'streamable_http'
  credential: string | null
  description: string
  headers?: Record<string, string>
}

export interface StdioServerConfig {
  command: string
  args: string[]
  transport: 'stdio'
  credential?: string | null
  description: string
  env?: Record<string, string>
}

export type McpServerConfig = HttpServerConfig | StdioServerConfig

// ─── Profile Config ────────────────────────────────────────────────

export interface ProfileConfig {
  description: string
  config_target: string
  model?: string
  allowed_servers: string[]
  denied_servers: string[]
  env_inject?: Record<string, string>
  max_tools?: number
}

// ─── Settings ──────────────────────────────────────────────────────

export interface DaemonSettings {
  port: number
  socket: string
  auto_start: boolean
}

export interface AuditSettings {
  enabled: boolean
  retention_days: number
  export_format: 'json' | 'csv'
}

export interface GlobalSettings {
  daemon: DaemonSettings
  audit: AuditSettings
}

// ─── Generator Config ──────────────────────────────────────────────

export interface GeneratorConfig {
  output: string
  format: string
}

// ─── Native Tool Config ────────────────────────────────────────────

export interface NativeToolConfig {
  enabled: boolean
  description: string
}

// ─── Instructions Config ───────────────────────────────────────────

export interface PerProfileInstructionConfig {
  extra_context?: string
  inject_into?: string
}

export interface InstructionsConfig {
  enabled: boolean
  output_dir: string
  per_profile?: Record<string, PerProfileInstructionConfig>
}

// ─── Root Config ───────────────────────────────────────────────────

/**
 * FamConfig — The root configuration type inferred from fam.yaml.
 *
 * This will be replaced by `z.infer<typeof FamConfigSchema>` once
 * the Zod schema is built in config/schema.ts. All fields match
 * the schema defined in DESIGN.md Section 5.1.
 */
export interface FamConfig {
  version: string
  settings: GlobalSettings
  credentials: Record<string, CredentialConfig>
  mcp_servers: Record<string, McpServerConfig>
  profiles: Record<string, ProfileConfig>
  generators: Record<string, GeneratorConfig>
  native_tools: Record<string, NativeToolConfig>
  instructions: InstructionsConfig
}

// ─── State File (Section 5.2) ──────────────────────────────────────

export interface CredentialState {
  type: 'api_key' | 'oauth2'
  exists_in_keychain: boolean
  last_set: string
  rotate_after_days?: number
  token_expires?: string
  refresh_token_exists?: boolean
}

export interface ServerState {
  transport: 'sse' | 'streamable_http' | 'stdio'
  url?: string
  command?: string
  credential: string | null
  status: 'healthy' | 'degraded' | 'unknown'
  last_reachable?: string
  tools_discovered: string[]
}

export interface ProfileState {
  session_token_hash: string
  allowed_servers: string[]
  tools_exposed_count: number
}

export interface GeneratedConfigState {
  path: string
  last_written: string
  content_hash: string
  strategy: 'import_and_manage' | 'overwrite' | 'skip'
}

export interface State {
  version: string
  last_applied: string
  applied_config_hash: string
  credentials: Record<string, CredentialState>
  mcp_servers: Record<string, ServerState>
  profiles: Record<string, ProfileState>
  generated_configs: Record<string, GeneratedConfigState>
}

// ─── Session Store (Section 5.3) ───────────────────────────────────

export interface SessionToken {
  profile: string
  created: string
  last_used?: string
}

export interface SessionStore {
  tokens: Record<string, SessionToken>
}

// ─── Plan Diff ─────────────────────────────────────────────────────

export interface DiffItem<T = string> {
  name: T
  detail?: string
}

export interface SectionDiff<T = string> {
  added: DiffItem<T>[]
  changed: DiffItem<T>[]
  removed: DiffItem<T>[]
}

export interface PlanDiff {
  credentials: SectionDiff
  servers: SectionDiff
  profiles: SectionDiff
  configs: SectionDiff
  hasChanges: boolean
  summary: {
    toAdd: number
    toChange: number
    toRemove: number
  }
}
