# FAM — Design Document

**FoFo Agent Manager: One config. Every agent.**

> This document is the implementation blueprint for FAM v0.1 (MVP).
> It expands on `requirements-design.md` with concrete architecture, data models,
> API contracts, module interfaces, and build milestones. An AI coder should be
> able to build from this document without guessing.
>
> **Author:** Forrester Terry
> **Version:** 0.1-draft
> **Last updated:** 2026-04-06
> **Status:** approved

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Module Design](#4-module-design)
5. [Data Models](#5-data-models)
6. [CLI Command Specification](#6-cli-command-specification)
7. [MCP Proxy Protocol](#7-mcp-proxy-protocol)
8. [Config Generator Specification](#8-config-generator-specification)
9. [Credential Vault](#9-credential-vault)
10. [Audit System](#10-audit-system)
11. [Daemon Lifecycle](#11-daemon-lifecycle)
12. [Error Handling](#12-error-handling)
13. [Security Model](#13-security-model)
14. [Testing Strategy](#14-testing-strategy)
15. [Project Structure](#15-project-structure)
16. [Dependency Inventory](#16-dependency-inventory)
17. [Build Milestones](#17-build-milestones)
18. [Open Questions & Decisions Log](#18-open-questions--decisions-log)

---

## 1. Problem Statement

AI agent tools (Claude Code, Cursor, VS Code Copilot, OpenHands, Gemini CLI, custom scripts) each maintain their own MCP server configs, credentials, and permissions in incompatible formats scattered across the filesystem. This creates three escalating problems:

1. **Credential chaos** — The same GitHub PAT is copy-pasted into 5 different config files. Rotation means updating 5 places. Secrets leak into plaintext JSON.
2. **Config fragmentation** — Adding an MCP server means editing `claude_desktop_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, etc. independently. They drift.
3. **Zero audit trail** — No record of which agent called which MCP tool, when, or whether it succeeded. Compliance is impossible.

**FAM solves this** by acting as a single MCP proxy daemon. One YAML config declares all agents, servers, credentials, and permissions. The daemon proxies all MCP traffic, injects credentials at runtime from the OS keychain, enforces per-profile scoping, and logs every call.

---

## 2. Design Principles

These supplement The Way of the FoFo's core tenets with FAM-specific guidance:

| Principle | What it means for FAM |
|---|---|
| **Terraform mental model** | `init` → `plan` → `apply`. Declarative desired state, computed diffs, explicit apply. Users who know Terraform feel at home immediately. |
| **Invisible middleware** | Agent tools should not know FAM exists. They connect to one MCP server at `localhost:7865` and discover their tools. FAM is plumbing, not a framework. |
| **Secrets never touch disk** | OS keychain only. No secrets in YAML, JSON, state files, logs, or environment variables that persist to disk. In-memory only, just-in-time. |
| **Degrade, don't crash** | If one upstream MCP server is down, the rest keep working. If a credential is missing, that server is unavailable — not the whole daemon. |
| **Local-first, always** | No cloud backend. No accounts. No telemetry. Everything runs on the developer's machine. Multi-machine sync (v1) is opt-in via git. |
| **One entry, not five** | Generated config files contain a single MCP server entry pointing to FAM. The tool discovers its allowed tools via `tools/list`. |

---

## 3. Architecture Overview

### 3.1 System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER MACHINE                            │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Claude   │  │ Cursor   │  │ VS Code  │  │ OpenHands /      │   │
│  │ Code     │  │          │  │ Copilot  │  │ Paperclip / Any  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │ MCP         │ MCP         │ MCP              │ MCP         │
│       │ + Bearer    │ + Bearer    │ + Bearer         │ + Bearer    │
│       └─────────────┼─────────────┼──────────────────┘             │
│                     ▼                                               │
│       ┌─────────────────────────────────────────┐                  │
│       │          FAM DAEMON (Fastify)            │                  │
│       │     localhost:7865 + Unix socket          │                  │
│       │                                           │                  │
│       │  ┌───────────┐ ┌──────────┐ ┌─────────┐ │                  │
│       │  │ MCP Server│ │ Auth     │ │ Config  │ │                  │
│       │  │ (SDK)     │ │ Engine   │ │ Engine  │ │                  │
│       │  │           │ │          │ │         │ │                  │
│       │  │ tools/list│ │ validate │ │ parse   │ │                  │
│       │  │ tools/call│ │ tokens   │ │ diff    │ │                  │
│       │  │ routing   │ │ scoping  │ │ generate│ │                  │
│       │  └─────┬─────┘ └──────────┘ └─────────┘ │                  │
│       │        │                                  │                  │
│       │  ┌─────▼──────────────────────────────┐  │                  │
│       │  │ Upstream Connection Manager         │  │                  │
│       │  │                                     │  │                  │
│       │  │  HTTP/SSE clients (MCP SDK)         │  │                  │
│       │  │  Stdio process pool (supervised)    │  │                  │
│       │  └─────────────────────────────────────┘  │                  │
│       │                                           │                  │
│       │  ┌──────────┐ ┌───────────┐ ┌──────────┐│                  │
│       │  │ Vault    │ │ Audit Log │ │ Native   ││                  │
│       │  │ (keyring)│ │ (SQLite)  │ │ Tools    ││                  │
│       │  └──────────┘ └───────────┘ └──────────┘│                  │
│       └─────────────────────────────────────────┘                  │
│                     │                                               │
│                     ▼                                               │
│       ┌─────────────────────────────────────────┐                  │
│       │       UPSTREAM MCP SERVERS               │                  │
│       │  HTTP/SSE: GitHub, Jira, GitLab, GDrive │                  │
│       │  Stdio: filesystem, sqlite, custom       │                  │
│       └─────────────────────────────────────────┘                  │
│                                                                     │
│       ┌─────────────────────────────────────────┐                  │
│       │       FILESYSTEM                         │                  │
│       │  fam.yaml        (source of truth)       │                  │
│       │  ~/.fam/state.json  (applied state)      │                  │
│       │  ~/.fam/sessions.json (token→profile)    │                  │
│       │  ~/.fam/audit.db  (call + change log)    │                  │
│       │  ~/.fam/configs/  (generated configs)    │                  │
│       │  ~/.fam/instructions/ (FAM.md files)     │                  │
│       │  ~/.fam/fam.pid   (daemon PID)           │                  │
│       │  ~/.fam/agent.sock (Unix socket)         │                  │
│       └─────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Request Flow (tool call)

```
1. Agent (e.g., Claude Code) sends MCP tools/call request to localhost:7865/mcp
   with Bearer token in Authorization header

2. Fastify receives HTTP request
   └─ MCP SDK server transport parses the MCP JSON-RPC message

3. Auth middleware extracts Bearer token
   ├─ Hash token → look up in sessions.json → resolve profile name
   ├─ If invalid/missing → return MCP error "unauthorized"
   └─ Attach profile to request context

4. Router inspects tool name prefix (e.g., "github__repos_list")
   ├─ Extract namespace: "github"
   ├─ Extract upstream tool name: "repos_list"
   └─ Check: is "github" in this profile's allowed_servers?
       ├─ No → return MCP error "tool not found" (don't leak existence)
       └─ Yes → continue

5. Credential injection
   ├─ Look up which credential "github" server requires (from fam.yaml)
   ├─ Pull credential from OS keychain via @napi-rs/keyring (just-in-time)
   ├─ If missing → return MCP error with message to run `fam secret set`
   └─ Inject into upstream request (header, env var, or OAuth token)

6. Forward to upstream
   ├─ HTTP/SSE server → MCP SDK client sends tools/call with credentials
   └─ Stdio server → route to the correct StdioClientTransport in process pool

7. Receive upstream response
   └─ Pass through to caller unmodified (FAM is transparent)

8. Audit log
   └─ INSERT into mcp_calls: profile, namespace, tool, status, response_time_ms

9. Return MCP response to agent
```

### 3.3 CLI Flow (plan/apply)

```
$ fam plan
│
├─ Parse fam.yaml → validate with Zod schema
├─ Load ~/.fam/state.json (last applied state)
├─ Diff each section:
│   ├─ credentials: declared vs stored in keychain
│   ├─ models: providers, credential bindings, model aliases
│   ├─ mcp_servers: URLs, transports, credential bindings
│   ├─ profiles: allowed_servers, denied_servers, model references
│   └─ generated_configs: hash would-be content vs state content_hash
├─ Format and print diff (Terraform-style + / ~ / - markers)
└─ Print summary: "N to add, N to change, N to destroy"

$ fam apply
│
├─ Run plan (same diff calculation)
├─ Prompt for confirmation if destructive changes
├─ For each new credential: prompt for value, store in keychain
├─ Resolve model references (provider/alias → model ID + API key from vault)
├─ For each config generator (now receives resolved model config):
│   ├─ First time + existing file? → interactive I/O/S prompt
│   ├─ Subsequent runs → upsert FAM entry silently
│   └─ Write generated config to target path
├─ Generate FAM.md instruction files per profile
├─ Generate/rotate session tokens for new profiles
├─ Write updated state.json (atomic write via temp file + rename)
├─ Reload daemon config (if running) via POST /api/v1/reload
└─ Record config_change in audit.db
```

---

## 4. Module Design

Each module is a directory under `src/` with a clear public interface. Modules communicate through typed interfaces, never by reaching into each other's internals.

### 4.1 Module Dependency Graph

```
                    ┌─────────┐
                    │  cli/   │  (entry point — depends on everything)
                    └────┬────┘
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     ┌─────────┐   ┌──────────┐   ┌──────────┐
     │ config/ │   │ daemon/  │   │ vault/   │
     └────┬────┘   └────┬─────┘   └────┬─────┘
          │              │              │
          │         ┌────┼────┐         │
          │         ▼    ▼    ▼         │
          │    ┌─────┐ ┌────┐ ┌──────┐  │
          │    │proxy│ │auth│ │native│  │
          │    └──┬──┘ └────┘ │tools │  │
          │       │           └──────┘  │
          ▼       ▼              ▼      ▼
     ┌──────────────────────────────────────┐
     │            audit/                     │
     └──────────────────────────────────────┘
     ┌──────────────────────────────────────┐
     │     generators/ (pure functions)      │
     └──────────────────────────────────────┘
```

### 4.2 Module Interfaces

#### `config/` — Configuration Engine

Owns parsing `fam.yaml`, managing `state.json`, and computing diffs.

```typescript
// config/schema.ts — Zod schemas for fam.yaml
export const FamConfigSchema: ZodType<FamConfig>

// config/parser.ts
export function parseConfig(yamlPath: string): FamConfig
// Reads YAML, validates with Zod, resolves env var interpolation (${VAR}).
// Throws ConfigValidationError on invalid YAML or schema violation.

// config/state.ts
export function loadState(famDir: string): State
export function writeState(famDir: string, state: State): void
// writeState uses atomic write: write to .tmp, rename over original.

// config/diff.ts
export function computeDiff(desired: FamConfig, current: State): PlanDiff
// Returns structured diff with add/change/remove for each section
// (credentials, models, servers, profiles, configs).

export function formatDiff(diff: PlanDiff): string
// Returns human-readable Terraform-style plan output.

// config/models.ts — Model reference resolution
export function parseModelRef(ref: string): { provider: string; alias: string } | null
// Parses "provider/alias" format. Returns null for bare strings.

export function resolveProfileModels(
  profileName: string, config: FamConfig, vault: CredentialVault
): Promise<ResolvedModelSet | null>
// Resolves all model references for a profile into concrete model IDs
// and API keys from the vault. Returns null if no model config.
```

#### `daemon/` — MCP Proxy Daemon

Owns the Fastify server, MCP protocol handling, and upstream connections.

```typescript
// daemon/server.ts
export function createDaemon(config: FamConfig, deps: DaemonDeps): FastifyInstance
// Registers MCP SSE transport, health endpoint, reload endpoint.
// Does NOT start listening — caller does that.

// daemon/proxy.ts
export class McpProxy {
  constructor(registry: ToolRegistry, vault: CredentialVault, audit: AuditLogger)
  handleToolCall(profile: string, toolName: string, args: unknown): Promise<McpResult>
  handleToolsList(profile: string): ToolDefinition[]
}
// Routes tool calls to upstream by namespace prefix.
// Injects credentials. Records audit entries.

// daemon/stdio-pool.ts
export class StdioPool {
  constructor(servers: StdioServerConfig[])
  start(): Promise<void>
  getTransport(namespace: string): StdioClientTransport
  stop(): Promise<void>
}
// Spawns stdio MCP servers as child processes. Supervises with auto-restart
// (max 3 failures in 60s, then mark degraded). Calls tools/list on each at
// startup to populate the tool registry.

// daemon/auth.ts
export class AuthEngine {
  constructor(sessions: SessionStore)
  resolveProfile(token: string): string | null
  // Hash token with SHA-256, look up in sessions map.
}

// daemon/native-tools.ts
export function getNativeTools(): ToolDefinition[]
export function handleNativeTool(name: string, args: unknown, ctx: CallContext): McpResult
// Implements: fam__whoami, fam__log_action, fam__list_servers, fam__health

// daemon/lifecycle.ts
export async function startDaemon(config: FamConfig): Promise<void>
export async function stopDaemon(): Promise<void>
export function getDaemonStatus(): DaemonStatus | null
// Manages PID file, port binding, signal handlers (SIGTERM/SIGINT),
// graceful shutdown sequence.
```

#### `vault/` — Credential Vault

Owns all interaction with the OS keychain.

```typescript
// vault/keychain.ts
export class KeychainVault implements CredentialVault {
  async get(name: string): Promise<string | null>
  async set(name: string, value: string): Promise<void>
  async delete(name: string): Promise<void>
  async exists(name: string): Promise<boolean>
  async list(): Promise<CredentialStatus[]>
}
// Wraps @napi-rs/keyring Entry class. Service name is always "fam".
// Each credential is `new Entry('fam', '<name>')`.
// Account naming: "<name>" for API keys,
//                 "<name>:access" / "<name>:refresh" / "<name>:expires" for OAuth.
// Note: @napi-rs/keyring has no "list all" API. Credential names are tracked
// via the `credentials` section of fam.yaml — we enumerate known names and
// look each up individually.

// vault/oauth.ts
export class OAuthManager {
  constructor(vault: KeychainVault)
  async getValidToken(credName: string, config: OAuthCredConfig): Promise<string>
  // Checks expiry. If expired, uses refresh token to get new access token.
  // Stores updated tokens back in keychain.
  async initiateFlow(credName: string, config: OAuthCredConfig): Promise<void>
  // Opens browser for OAuth authorization_code flow.
  // Starts temporary local server to receive callback.
}

// vault/inject.ts
export function injectCredential(
  server: McpServerConfig,
  credential: string,
  transport: 'http_header' | 'env_var' | 'query_param'
): InjectedRequest
// Pure function. Takes a credential value and returns the modified
// request/environment with the credential injected in the right place.
```

#### `generators/` — Config File Generators

Pure functions. No side effects. Each takes a profile + settings + resolved models, returns file content.

```typescript
// generators/types.ts
export interface GeneratorInput {
  profile: ProfileConfig
  settings: GlobalSettings
  sessionToken: string
  daemonUrl: string                // e.g., "http://localhost:7865"
  models?: ResolvedModelSet | null // Resolved model config with API keys
}

export interface GeneratorOutput {
  path: string            // Absolute target path (~ expanded)
  content: string         // File content to write (JSON, TOML, etc.)
  format: string          // For logging: "json", "toml", etc.
  warnings?: string[]     // Info messages (e.g., "model config is GUI-only")
}

// generators/claude-code.ts — env block with ANTHROPIC_* vars + MCP
export function generateClaudeCodeConfig(input: GeneratorInput): GeneratorOutput

// generators/opencode.ts — providers + agents sections + MCP
export function generateOpenCodeConfig(input: GeneratorInput): GeneratorOutput

// generators/openhands.ts — [llm] section + [mcp]
export function generateOpenHandsConfig(input: GeneratorInput): GeneratorOutput

// generators/aider.ts — .aider.conf.yml with model/editor-model/weak-model
export function generateAiderConfig(input: GeneratorInput): GeneratorOutput

// generators/continue-dev.ts — config.yaml with models[] + mcpServers
export function generateContinueDevConfig(input: GeneratorInput): GeneratorOutput

// generators/openclaw.ts — openclaw.json (mcpServers + providers) + models.yaml (tiers)
export function generateOpenClawConfig(input: GeneratorInput): GeneratorOutput
export function generateOpenClawModelsYaml(input: GeneratorInput): GeneratorOutput | null

// generators/nemoclaw.ts — openclaw.json (mcpServers) + env var hints
export function generateNemoClawConfig(input: GeneratorInput): GeneratorOutput

// generators/cursor.ts, vscode.ts, windsurf.ts, zed.ts — MCP only
// generators/cline.ts — partial model support via cline.* settings
// generators/gemini-cli.ts — model.name in settings
// generators/github-copilot.ts, amazon-q.ts — env var hints
// generators/generic.ts — minimal JSON for custom tools

// generators/instructions.ts
export function generateInstructionFile(input: InstructionInput): GeneratorOutput
// Generates FAM.md per profile with available tools, usage instructions,
// and any extra_context from fam.yaml.
```

#### `audit/` — Audit Logging

Owns the SQLite database for call logs and config change records.

```typescript
// audit/logger.ts
export class AuditLogger {
  constructor(dbPath: string)
  async init(): Promise<void>                    // Creates tables if needed, runs migrations
  logCall(entry: McpCallEntry): void             // Synchronous (better-sqlite3)
  logConfigChange(entry: ConfigChangeEntry): void
  query(filters: AuditFilters): AuditEntry[]
  export(format: 'json' | 'csv', filters: AuditFilters): string
  close(): void
}

// audit/schema.sql — see Section 10 for full DDL
```

---

## 5. Data Models

### 5.1 `fam.yaml` Zod Schema

This is the core data model. Everything flows from this.

```typescript
import { z } from 'zod'

// ─── Credentials ───────────────────────────────────────────────

const ApiKeyCredentialSchema = z.object({
  type: z.literal('api_key'),
  description: z.string(),
  env_var: z.string().optional(),
  rotate_after_days: z.number().int().positive().optional(),
})

const OAuth2CredentialSchema = z.object({
  type: z.literal('oauth2'),
  description: z.string(),
  provider: z.string(),                    // "google", "atlassian", "github", etc.
  client_id: z.string(),                   // Can contain ${ENV_VAR} references
  scopes: z.array(z.string()),
})

const CredentialSchema = z.discriminatedUnion('type', [
  ApiKeyCredentialSchema,
  OAuth2CredentialSchema,
])

// ─── MCP Servers ───────────────────────────────────────────────

const HttpMcpServerSchema = z.object({
  url: z.string().url(),
  transport: z.enum(['sse', 'streamable_http']),
  credential: z.string().nullable(),       // References credentials.<name>
  description: z.string(),
  headers: z.record(z.string()).optional(),
})

const StdioMcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  transport: z.literal('stdio'),
  credential: z.string().nullable().optional(),
  description: z.string(),
  env: z.record(z.string()).optional(),    // Extra env vars for the process
})

const McpServerSchema = z.union([HttpMcpServerSchema, StdioMcpServerSchema])

// ─── Model Providers ──────────────────────────────────────────

const ModelProviderTypeSchema = z.enum([
  'anthropic', 'openai', 'openai_compatible', 'google', 'amazon_bedrock',
])

const ModelProviderSchema = z.object({
  provider: ModelProviderTypeSchema,
  credential: z.string().nullable(),       // References credentials.<name>
  base_url: z.string().url().optional(),   // For proxies / custom endpoints
  models: z.record(z.string()),            // alias → actual model ID
})

// ─── Profiles ──────────────────────────────────────────────────

const ProfileSchema = z.object({
  description: z.string(),
  config_target: z.string(),               // Generator name
  model: z.string().optional(),            // "provider/alias" or bare string
  model_roles: z.record(z.string()).optional(), // role → "provider/alias"
  allowed_servers: z.array(z.string()),
  denied_servers: z.array(z.string()).default([]),
  env_inject: z.record(z.string()).optional(),  // "KEY": "credential:<name>" or literal
  max_tools: z.number().int().positive().optional(),
})

// ─── Generators ────────────────────────────────────────────────

const GeneratorSchema = z.object({
  output: z.string(),                      // Path (supports ~ and ${vars})
  format: z.string(),                      // Generator format identifier
})

// ─── Native Tools ──────────────────────────────────────────────

const NativeToolSchema = z.object({
  enabled: z.boolean().default(true),
  description: z.string(),
})

// ─── Instructions ──────────────────────────────────────────────

const PerProfileInstructionSchema = z.object({
  extra_context: z.string().optional(),
  inject_into: z.string().optional(),      // e.g., "AGENTS.md"
})

const InstructionsSchema = z.object({
  enabled: z.boolean().default(true),
  output_dir: z.string().default('~/.fam/instructions/'),
  per_profile: z.record(PerProfileInstructionSchema).optional(),
})

// ─── Settings ──────────────────────────────────────────────────

const DaemonSettingsSchema = z.object({
  port: z.number().int().default(7865),
  socket: z.string().default('~/.fam/agent.sock'),
  auto_start: z.boolean().default(true),
})

const AuditSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  retention_days: z.number().int().positive().default(90),
  export_format: z.enum(['json', 'csv']).default('json'),
})

const SettingsSchema = z.object({
  daemon: DaemonSettingsSchema.default({}),
  audit: AuditSettingsSchema.default({}),
})

// ─── Root Config ───────────────────────────────────────────────

export const FamConfigSchema = z.object({
  version: z.string(),
  settings: SettingsSchema.default({}),
  credentials: z.record(CredentialSchema).default({}),
  models: z.record(ModelProviderSchema).default({}),
  mcp_servers: z.record(McpServerSchema).default({}),
  profiles: z.record(ProfileSchema),
  generators: z.record(GeneratorSchema).default({}),
  native_tools: z.record(NativeToolSchema).default({}),
  instructions: InstructionsSchema.default({}),
})
// Cross-field validation via .superRefine():
// - Model provider credentials must exist in credentials section
// - Profile model refs ("provider/alias") must resolve to valid entries

export type FamConfig = z.infer<typeof FamConfigSchema>
```

### 5.2 State File (`~/.fam/state.json`)

```typescript
interface State {
  version: string
  last_applied: string                     // ISO 8601
  applied_config_hash: string              // SHA-256 of fam.yaml at apply time

  credentials: Record<string, {
    type: 'api_key' | 'oauth2'
    exists_in_keychain: boolean
    last_set: string                       // ISO 8601
    rotate_after_days?: number
    token_expires?: string                 // OAuth only, ISO 8601
    refresh_token_exists?: boolean         // OAuth only
  }>

  models: Record<string, {
    provider: string                       // e.g., "anthropic", "openai"
    credential: string | null              // credential name (not value)
    model_aliases: string[]                // e.g., ["sonnet", "opus", "haiku"]
  }>

  mcp_servers: Record<string, {
    transport: 'sse' | 'streamable_http' | 'stdio'
    url?: string                           // HTTP servers
    command?: string                       // Stdio servers
    credential: string | null
    status: 'healthy' | 'degraded' | 'unknown'
    last_reachable?: string                // ISO 8601
    tools_discovered: string[]             // Tool names (without namespace prefix)
  }>

  profiles: Record<string, {
    session_token_hash: string             // SHA-256 of the token
    allowed_servers: string[]
    tools_exposed_count: number
  }>

  generated_configs: Record<string, {
    path: string
    last_written: string                   // ISO 8601
    content_hash: string                   // SHA-256 of generated content
    strategy: 'import_and_manage' | 'overwrite' | 'skip'
  }>
}
```

### 5.3 Session Store (`~/.fam/sessions.json`)

```typescript
interface SessionStore {
  // Key: SHA-256 hash of the token. Value: profile name.
  // Tokens themselves are shown once at registration and never stored.
  tokens: Record<string, {
    profile: string
    created: string                        // ISO 8601
    last_used?: string                     // ISO 8601
  }>
}
```

### 5.4 Audit Database Schema (`~/.fam/audit.db`)

```sql
-- MCP call log: every proxied tool call
CREATE TABLE mcp_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  profile     TEXT NOT NULL,               -- caller's profile name
  server_ns   TEXT NOT NULL,               -- server namespace (e.g., "github")
  tool_name   TEXT NOT NULL,               -- upstream tool name (e.g., "repos_list")
  status      TEXT NOT NULL,               -- 'success' | 'error' | 'timeout' | 'denied'
  latency_ms  INTEGER,                     -- response time in milliseconds
  error_msg   TEXT                          -- error message (null on success)
);

-- Config change log: every apply, secret set, register, etc.
CREATE TABLE config_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,               -- 'apply' | 'secret_set' | 'secret_delete'
                                           -- | 'register' | 'revoke' | 'import'
  target      TEXT NOT NULL,               -- what was changed (profile name, cred name, etc.)
  details     TEXT                          -- JSON blob with before/after or extra context
);

-- Indexes for common queries
CREATE INDEX idx_calls_timestamp ON mcp_calls(timestamp);
CREATE INDEX idx_calls_profile   ON mcp_calls(profile);
CREATE INDEX idx_calls_server    ON mcp_calls(server_ns);
CREATE INDEX idx_changes_ts      ON config_changes(timestamp);
CREATE INDEX idx_changes_action  ON config_changes(action);
```

### 5.5 Tool Registry (in-memory, built at daemon startup)

```typescript
interface ToolEntry {
  namespacedName: string       // "github__repos_list"
  upstreamName: string         // "repos_list"
  namespace: string            // "github"
  description: string
  inputSchema: object          // JSON Schema from upstream tools/list
  source: 'upstream' | 'native'
}

interface ToolRegistry {
  // All tools from all connected servers + native tools
  allTools: Map<string, ToolEntry>

  // Pre-computed filtered views per profile
  profileViews: Map<string, ToolEntry[]>

  // Rebuild after upstream reconnect or config reload
  rebuild(upstreamTools: Map<string, ToolDefinition[]>, config: FamConfig): void
}
```

---

## 6. CLI Command Specification

The CLI is the primary UX surface. Commands follow the Terraform mental model where applicable.

### Entry point

```
fam <command> [options]
```

Global options:
- `--config <path>` — Path to fam.yaml (default: `./fam.yaml`, then `~/.fam/fam.yaml`)
- `--fam-dir <path>` — Path to FAM data directory (default: `~/.fam`)
- `--verbose` / `-v` — Verbose output
- `--json` — JSON output for scripting
- `--no-color` — Disable color output

### 6.1 `fam init`

Create a new `fam.yaml` with interactive prompts.

```
fam init [--dir <path>]

Behavior:
1. Check if fam.yaml already exists → warn and exit (unless --force)
2. Prompt: "Which tools do you use?" (multi-select: Claude Code, Cursor, VS Code, Other)
3. Prompt: "Any MCP servers to add?" (or skip)
4. Scan for existing MCP configs:
   - ~/.config/claude/claude_desktop_config.json
   - ~/.cursor/mcp.json
   - .vscode/mcp.json
   If found, offer to import them into the YAML
5. Write fam.yaml scaffold
6. Create ~/.fam/ directory structure
7. Print next steps: "Run `fam plan` to review, `fam apply` to activate"

Exit codes: 0 = success, 1 = already exists (no --force)
```

### 6.2 `fam plan`

Show what `apply` would do, without changing anything.

```
fam plan

Behavior:
1. Parse and validate fam.yaml
2. Load state.json (empty state if first run)
3. Check credential existence in keychain (non-blocking)
4. Compute diff (desired vs current)
5. Print formatted diff (see requirements-design.md Section 6 for format)
6. Print summary line: "Plan: N to add, N to change, N to destroy."

Exit codes: 0 = no changes, 2 = changes pending
```

### 6.3 `fam apply`

Apply the declared configuration.

```
fam apply [--yes] [--dry-run]

Behavior:
1. Run plan
2. If changes exist and not --yes, prompt for confirmation
3. Execute changes:
   a. New credentials → prompt for values, store in keychain
   b. Config generators → write/update files (with I/O/S for first-time)
   c. New profiles → generate session tokens, store in sessions.json
   d. Update state.json atomically
   e. Generate instruction files (FAM.md per profile)
4. If daemon is running → POST /api/v1/reload to hot-reload config
5. Record config_change in audit.db
6. Print summary: "Apply complete. N resources created, N updated."

Exit codes: 0 = success, 1 = error, 2 = user declined
```

### 6.4 `fam daemon start|stop|restart|status`

Manage the daemon lifecycle.

```
fam daemon start [--foreground]
  Start the daemon. Default: background (daemonize).
  --foreground: stay attached, log to stdout.
  Writes PID to ~/.fam/fam.pid.
  Listens on configured port + Unix socket.

fam daemon stop
  Send SIGTERM to PID from fam.pid. Wait up to 5s for graceful shutdown.
  If still running after 5s, SIGKILL.

fam daemon restart
  stop + start.

fam daemon status
  Print: running/stopped, PID, uptime, port, connected servers,
  connected profiles, last 24h call stats.

Exit codes: 0 = success/running, 1 = error, 3 = not running (for status)
```

### 6.5 `fam secret set|get|list|delete`

Manage credentials in the OS keychain.

```
fam secret set <name>
  Prompt for value (hidden input). Store in keychain as "fam/<name>".
  If credential not declared in fam.yaml, warn but allow.

fam secret get <name>
  Print the stored value. Require --yes flag (safety: don't accidentally
  print secrets in shared terminals).

fam secret list
  Print table: name, type, stored (yes/no), rotation status, expiry.
  Never print actual values.

fam secret delete <name>
  Remove from keychain. Prompt for confirmation.

Exit codes: 0 = success, 1 = not found / keychain error
```

### 6.6 `fam register <profile> [--rotate] [--revoke]`

Manage session tokens for tool profiles.

```
fam register <profile>
  Generate a new session token (crypto.randomBytes(32), hex-encoded,
  prefixed with "fam_sk_<profile_short>_").
  Store SHA-256 hash in sessions.json, mapped to profile name.
  Print the token ONCE. It cannot be retrieved later.

fam register --rotate <profile>
  Generate new token, invalidate old one. Print new token.

fam register --revoke <profile>
  Remove token from sessions.json. Profile can no longer authenticate.

Exit codes: 0 = success, 1 = profile not found
```

### 6.7 `fam mcp add|remove|list`

Quick-manage MCP servers without editing YAML.

```
fam mcp add <name> --url <url> --transport <sse|streamable_http|stdio> [--credential <cred>]
  Add an MCP server entry to fam.yaml. Validate URL format.
  For stdio: --command and --args instead of --url.

fam mcp remove <name>
  Remove from fam.yaml. Warn if profiles reference it.

fam mcp list
  Print table: name, transport, URL/command, credential, status (if daemon running).

Exit codes: 0 = success, 1 = error
```

### 6.8 `fam validate`

Pre-apply validation with connectivity checks.

```
fam validate

Behavior:
1. Parse and validate fam.yaml schema
2. Check all credentials exist in keychain
3. For HTTP MCP servers: attempt connection (HEAD or tools/list with timeout)
4. For stdio MCP servers: attempt spawn + tools/list
5. For profiles: validate all referenced servers exist
6. For generators: validate output paths are writable
7. Check for tool count limits (e.g., Cursor's 40-tool limit)

Print results as pass/warn/fail checklist.
Exit codes: 0 = all pass, 1 = any fail (warnings don't fail)
```

### 6.9 `fam status`

Quick health overview (alias for `fam daemon status` with extra info).

```
fam status

Output:
  Daemon: running (PID 12345, uptime 3d 4h) | stopped
  Config: fam.yaml valid | invalid (error details)
  Servers: 5/5 healthy | 4/5 healthy (n8n: degraded)
  Profiles: claude-code (active), cursor (idle), paperclip (no token)
  Last 24h: 142 calls, 0 errors, avg 45ms
  Credentials: 5/5 present | 4/5 present (jira-oauth: missing)
```

### 6.10 `fam log`

Query the audit log.

```
fam log [--profile <name>] [--server <ns>] [--since <duration>] [--limit <n>] [--status <status>]

Default: last 50 calls.
--since accepts: "1h", "24h", "7d", "30d"
--status: "success", "error", "denied", "timeout"

fam log export [--format json|csv] [--since <duration>] [--output <path>]
  Export audit log to file.
```

---

## 7. MCP Proxy Protocol

### 7.1 Transport

The daemon exposes a single MCP server endpoint using the official `@modelcontextprotocol/sdk` server implementation:

- **SSE transport** at `http://localhost:7865/mcp` (primary)
- **Streamable HTTP** at `http://localhost:7865/mcp` (same endpoint, content-type negotiated)
- **Unix socket** at `~/.fam/agent.sock` (same protocol, lower latency)

The MCP SDK handles all JSON-RPC framing, capability negotiation, and streaming.

### 7.2 Tool Namespacing

All upstream tools are prefixed with their server namespace using double underscore (`__`) as separator:

```
Upstream tool "repos_list" from server "github"
→ Presented as "github__repos_list"

Upstream tool "trigger_workflow" from server "n8n"
→ Presented as "n8n__trigger_workflow"

Native tool "whoami"
→ Presented as "fam__whoami"
```

**Why double underscore:**
- Single underscore is too common in tool names
- Slash conflicts with URLs
- Dot conflicts with JSON paths
- Double underscore is unambiguous and easily split

### 7.3 `tools/list` Response

When a client calls `tools/list`, FAM returns only the tools allowed by the caller's profile:

```json
{
  "tools": [
    {
      "name": "github__repos_list",
      "description": "[github] List repositories",
      "inputSchema": { /* original schema from upstream */ }
    },
    {
      "name": "github__issues_create",
      "description": "[github] Create an issue",
      "inputSchema": { /* ... */ }
    },
    {
      "name": "fam__whoami",
      "description": "Returns your profile name, allowed servers, and permissions",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "fam__log_action",
      "description": "Report a significant action for the audit trail",
      "inputSchema": {
        "type": "object",
        "properties": {
          "action": { "type": "string", "description": "Action name" },
          "description": { "type": "string", "description": "What happened" },
          "metadata": { "type": "object", "description": "Optional extra data" }
        },
        "required": ["action", "description"]
      }
    }
  ]
}
```

The `[namespace]` prefix in descriptions helps agents understand tool grouping.

### 7.4 `tools/call` Routing

```typescript
// Pseudocode for tool call routing
async function handleToolCall(profile: string, call: ToolCallRequest): Promise<ToolCallResult> {
  const [namespace, ...rest] = call.name.split('__')
  const upstreamToolName = rest.join('__')  // Rejoin in case upstream uses __

  // Native tool?
  if (namespace === 'fam') {
    return handleNativeTool(upstreamToolName, call.arguments, { profile })
  }

  // Find upstream server
  const server = registry.getServer(namespace)
  if (!server) return mcpError(-32601, 'Tool not found')

  // Check profile access
  if (!isAllowed(profile, namespace)) {
    audit.logCall({ profile, server_ns: namespace, tool_name: upstreamToolName, status: 'denied' })
    return mcpError(-32601, 'Tool not found')  // Don't leak existence
  }

  // Inject credentials
  const credential = await vault.getForServer(namespace)

  // Forward to upstream
  const startTime = Date.now()
  try {
    const result = await server.callTool(upstreamToolName, call.arguments, credential)
    audit.logCall({
      profile, server_ns: namespace, tool_name: upstreamToolName,
      status: 'success', latency_ms: Date.now() - startTime
    })
    return result
  } catch (err) {
    audit.logCall({
      profile, server_ns: namespace, tool_name: upstreamToolName,
      status: 'error', latency_ms: Date.now() - startTime, error_msg: err.message
    })
    return mcpError(-32603, `Upstream error: ${err.message}`)
  }
}
```

### 7.5 Native Tool Implementations

#### `fam__whoami`

```typescript
// Input: {} (no params)
// Output:
{
  profile: "claude-code",
  allowed_servers: ["github", "gitlab", "filesystem", "n8n"],
  denied_servers: ["jira"],
  tool_count: 18,
  native_tools: ["fam__whoami", "fam__log_action", "fam__list_servers", "fam__health"]
}
```

#### `fam__log_action`

```typescript
// Input: { action: string, description: string, metadata?: object }
// Behavior: writes to config_changes table with action="agent_report"
// Output: { logged: true, id: <entry_id> }
```

#### `fam__list_servers`

```typescript
// Input: {} (no params)
// Output:
{
  servers: [
    { name: "github", description: "GitHub repos, issues, PRs", status: "healthy", tool_count: 12 },
    { name: "n8n", description: "Local n8n workflow engine", status: "healthy", tool_count: 3 }
  ]
}
```

#### `fam__health`

```typescript
// Input: {} (no params)
// Output:
{
  daemon: { status: "healthy", uptime_seconds: 86400, version: "0.1.0" },
  servers: {
    github: { status: "healthy", last_reachable: "2026-04-06T14:29:55Z", tool_count: 12 },
    n8n: { status: "degraded", error: "connection refused", last_reachable: "2026-04-06T12:00:00Z" }
  }
}
```

---

## 8. Config Generator Specification

### 8.1 Generated Output Format

All generators produce a single MCP server entry pointing to FAM. The token is embedded in the URL query param (fallback) or headers (preferred), depending on what the target tool supports.

#### Claude Code (dual-file output)

Claude Code 2.x reads MCP servers from `~/.claude.json` (top-level `mcpServers`, entry shape uses `"type": "http"`) and reads env vars from `~/.claude/settings.json`. FAM writes both files; the secondary file is emitted via the generator's `additionalFiles` mechanism and merged with `import_and_manage` to preserve user-added keys.

**Primary: `~/.claude.json`**
```json
{
  "mcpServers": {
    "fam": {
      "type": "http",
      "url": "http://localhost:7865/mcp",
      "headers": {
        "Authorization": "Bearer fam_sk_cld_a1b2c3d4..."
      }
    }
  }
}
```

**Secondary (only when a compatible Anthropic model is configured): `~/.claude/settings.json`**
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "ANTHROPIC_MODEL": "claude-sonnet-4-20250514",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-20250514",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-20250514",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5-20251001"
  }
}
```

`claude mcp list` reads the primary file. Claude Code picks up the env block at startup when launched from a shell where those vars are inherited.

#### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "fam": {
      "url": "http://localhost:7865/mcp",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer fam_sk_cur_e5f6g7h8..."
      }
    }
  }
}
```

#### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "fam": {
      "type": "sse",
      "url": "http://localhost:7865/mcp",
      "headers": {
        "Authorization": "Bearer fam_sk_vsc_i9j0k1l2..."
      }
    }
  }
}
```

#### OpenHands (`~/.openhands/config.toml`)

```toml
[llm]
api_key = "fam_sk_oh_m3n4o5p6..."  # Injected from credential reference
model = "claude-sonnet-4"

[mcp]
servers = [
  { name = "fam", url = "http://localhost:7865/mcp", transport = "sse" }
]
```

#### Generic (`~/.fam/configs/<profile>.json`)

```json
{
  "profile": "paperclip",
  "mcp_endpoint": "http://localhost:7865/mcp",
  "token": "fam_sk_ppr_q7r8s9t0...",
  "transport": "sse"
}
```

### 8.2 First-Time Merge Strategy

When `fam apply` encounters an existing config file for the first time, it presents three options interactively:

1. **Import (I)** — Parse existing config, create `mcp_servers` entries in `fam.yaml` for each found server, back up original, write FAM-only config. The imported servers are now proxied through FAM.

2. **Overwrite (O)** — Back up original to `<file>.pre-fam`, write FAM-only config. Existing non-FAM servers stop working (user can add them to `fam.yaml` later).

3. **Skip (S)** — Don't touch the file. Record strategy as `skip` in state.json. User manages manually.

**Subsequent applies:** Strategy is stored in `state.json`. `import_and_manage` and `overwrite` profiles get their FAM entry upserted silently. `skip` profiles are left alone. `fam config manage <profile>` re-triggers the interactive prompt.

### 8.3 Instruction File (FAM.md) Generation

Generated per profile. Includes:
- Profile name and description
- Available tools grouped by server
- FAM native tools
- Connection instructions
- Any `extra_context` from `fam.yaml`

Optionally injected into an existing file (e.g., `AGENTS.md`) when `inject_into` is set.

---

## 9. Credential Vault

### 9.1 Keychain Storage Convention

Uses `@napi-rs/keyring` (package: `@napi-rs/keyring`, repo: `Brooooooklyn/keyring-node`).
The API is class-based — each credential is an `Entry` instance:

```typescript
import { Entry } from '@napi-rs/keyring'

// API key — one entry
const entry = new Entry('fam', 'github-pat')
entry.setPassword('ghp_abc123...')
const token = entry.getPassword()    // returns string
entry.deletePassword()

// OAuth — multiple entries per credential
new Entry('fam', 'google-oauth:access').setPassword('<access_token>')
new Entry('fam', 'google-oauth:refresh').setPassword('<refresh_token>')
new Entry('fam', 'google-oauth:expires').setPassword('2026-04-07T14:30:00Z')
```

All credentials stored under service name `"fam"`:

| Credential Type | Account Pattern | Example |
|---|---|---|
| API key | `<name>` | `github-pat` |
| OAuth access token | `<name>:access` | `google-oauth:access` |
| OAuth refresh token | `<name>:refresh` | `google-oauth:refresh` |
| OAuth token expiry | `<name>:expires` | `google-oauth:expires` |

**Listing credentials:** `@napi-rs/keyring` has no "list all entries for a service" API.
Instead, `fam secret list` enumerates credential names from `fam.yaml`'s `credentials:`
section and probes each with `entry.getPassword()` (catch error = not stored).
This is the right approach — `fam.yaml` is the declaration of what *should* exist,
and the keychain is checked against it.

### 9.2 Credential Lifecycle

```
Declaration (fam.yaml)
  ↓
Storage (fam secret set → OS keychain)
  ↓
Retrieval (just-in-time, on tool call)
  ↓
Injection (into upstream MCP request)
  ↓
No caching (pulled fresh every time from keychain)
```

**Why no in-memory caching:** Keychain access is fast (< 1ms on macOS). Caching adds complexity (invalidation, memory leaks, security surface). The vault is pull-only, just-in-time.

### 9.3 OAuth Flow (v1 — deferred from MVP)

MVP supports API keys only. OAuth2 support is a v1 feature. The schema supports declaring OAuth credentials in `fam.yaml` now, but `fam apply` will log a warning: "OAuth credentials require manual token setup. Store tokens with `fam secret set <name>:access`."

**v1 OAuth flow:**
1. `fam auth <credential>` starts a local HTTP server on a random port
2. Opens browser to provider's authorization URL
3. Receives callback with authorization code
4. Exchanges code for access + refresh tokens via `simple-oauth2`
5. Stores both tokens in keychain
6. Handles automatic refresh when access token expires

---

## 10. Audit System

### 10.1 What Gets Logged

| Event | Table | Key Fields |
|---|---|---|
| Every MCP tool call (proxied or native) | `mcp_calls` | profile, server_ns, tool_name, status, latency_ms |
| `fam apply` | `config_changes` | action="apply", details=JSON diff summary |
| `fam secret set/delete` | `config_changes` | action="secret_set"/"secret_delete", target=cred name |
| `fam register/rotate/revoke` | `config_changes` | action="register"/"rotate"/"revoke", target=profile |
| Agent-reported actions | `config_changes` | action="agent_report", target=profile, details=agent's message |
| Denied access attempts | `mcp_calls` | status="denied" |

### 10.2 What Does NOT Get Logged

- **Request/response bodies** — Could contain sensitive data. Only a hash of request params for correlation.
- **Credential values** — Never. Not even hashed.
- **Raw error stack traces** — Only the error message string.

### 10.3 Retention

Configurable via `settings.audit.retention_days` (default: 90). A daily cleanup job (or on daemon startup) deletes entries older than the retention period.

```sql
DELETE FROM mcp_calls WHERE timestamp < datetime('now', '-90 days');
DELETE FROM config_changes WHERE timestamp < datetime('now', '-90 days');
```

### 10.4 Export

```bash
fam log export --format json --since 30d --output ~/audit-export.json
```

JSON format:
```json
{
  "exported_at": "2026-04-06T15:00:00Z",
  "period": { "from": "2026-03-07", "to": "2026-04-06" },
  "calls": [ /* mcp_calls rows as objects */ ],
  "changes": [ /* config_changes rows as objects */ ]
}
```

---

## 11. Daemon Lifecycle

### 11.1 Startup Sequence

```
fam daemon start
│
├─ 1. Check for existing PID file
│     ├─ PID file exists + process alive → exit with "already running"
│     └─ PID file exists + process dead → remove stale PID, continue
│
├─ 2. Load and validate fam.yaml (exit 1 on invalid)
│
├─ 3. Load state.json (warn if missing, use empty state)
│
├─ 4. Open/create audit.db
│     └─ Run CREATE TABLE IF NOT EXISTS (idempotent migrations)
│
├─ 5. Check credentials in keychain (warn on missing, don't fail)
│
├─ 6. Connect to upstream MCP servers
│     ├─ Stdio servers: spawn child processes via StdioClientTransport
│     │   └─ Call tools/list on each → populate registry
│     └─ HTTP/SSE servers: create MCP client connections
│         └─ Call tools/list on each → populate registry
│         └─ If unreachable: mark degraded, retry every 60s
│
├─ 7. Build unified tool registry
│     ├─ Namespace-prefix all upstream tools
│     ├─ Add native tools (fam__whoami, etc.)
│     └─ Build per-profile filtered views
│
├─ 8. Load session tokens from sessions.json
│
├─ 9. Start Fastify server
│     ├─ POST/GET /mcp (MCP SSE/streamable HTTP transport)
│     ├─ GET /health (JSON health check)
│     └─ POST /api/v1/reload (hot-reload config — localhost only)
│     Bind to: TCP port + Unix socket
│
├─ 10. If not --foreground: daemonize (fork + detach)
│
└─ 11. Write PID file
       Log: "FAM daemon started — 5 servers, 42 tools, 3 profiles"
```

### 11.2 Graceful Shutdown

On SIGTERM or SIGINT:

```
1. Stop accepting new connections (close server listeners)
2. Drain in-flight MCP calls (5-second timeout)
3. Send SIGTERM to all stdio child processes
   └─ Wait 3s, then SIGKILL any remaining
4. Close SQLite database connection
5. Remove PID file
6. Remove Unix socket file
7. Exit 0
```

### 11.3 Hot Reload

`POST /api/v1/reload` (localhost-only, no auth required — it's local):

```
1. Re-parse fam.yaml
2. Validate schema
3. Diff against running config
4. Apply changes:
   - New MCP servers → connect + discover tools
   - Removed MCP servers → disconnect + clean up
   - Changed profiles → rebuild filtered views
   - Changed credentials → no action (pulled JIT from keychain)
5. Rebuild tool registry
6. Return: { success: true, changes: [...] }
```

### 11.4 Auto-Start

On macOS, `fam daemon install` creates a launchd plist:

```xml
<!-- ~/Library/LaunchAgents/com.sweetpapatech.fam.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sweetpapatech.fam</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/fam</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>~/.fam/daemon.log</string>
  <key>StandardErrorPath</key><string>~/.fam/daemon.err</string>
</dict>
</plist>
```

On Linux, `fam daemon install` creates a systemd user unit:

```ini
# ~/.config/systemd/user/fam.service
[Unit]
Description=FAM - FoFo Agent Manager Daemon
After=network.target

[Service]
ExecStart=/usr/local/bin/fam daemon start --foreground
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

---

## 12. Error Handling

### 12.1 Philosophy

**Degrade gracefully. Never crash the daemon. Always log. Always tell the user what to do.**

### 12.2 Error Categories and Responses

| Scenario | Daemon Behavior | User-Facing Message |
|---|---|---|
| **fam.yaml invalid** | `plan`/`apply` refuse to run. Running daemon keeps last valid config. | Schema error with line number + field path |
| **Credential missing from keychain** | Return MCP error to caller for that tool. Other servers unaffected. | `"Credential 'github-pat' not found. Run: fam secret set github-pat"` |
| **Upstream HTTP server unreachable** | Mark degraded. Background retry every 60s. Other servers unaffected. | `"Server 'github' is unreachable. Tools prefixed 'github__' unavailable."` |
| **Upstream HTTP server returns error** | Pass error through to caller. Log in audit. | Original upstream error message |
| **Stdio process crashes** | Auto-restart (max 3 in 60s, then mark degraded). | `"Server 'filesystem' crashed and was restarted."` / `"Server 'filesystem' is degraded (too many crashes)."` |
| **Invalid/missing Bearer token** | Return MCP error "unauthorized". Log the attempt. | `"Invalid or missing authentication token."` |
| **Tool not in caller's scope** | Return "tool not found" (don't leak existence). Log as DENIED. | `"Tool not found."` |
| **Port already in use** | Exit with clear message. | `"Port 7865 is already in use. Check: lsof -i :7865"` |
| **Keychain access denied by OS** | Log with instructions. Fail the credential operation. | `"Keychain access denied. Grant terminal access in System Settings > Privacy."` |
| **PID file stale (process dead)** | Remove stale PID, continue startup. | `"Removed stale PID file. Previous daemon didn't shut down cleanly."` |
| **state.json missing/corrupt** | Warn, proceed with empty state. Next `apply` recreates it. | `"No state file found. Treating as fresh install."` |
| **fam.yaml not found** | Exit with helpful message. | `"No fam.yaml found. Run: fam init"` |

### 12.3 Error Type Hierarchy

```typescript
// All FAM errors extend this base
class FamError extends Error {
  constructor(
    public code: string,      // Machine-readable: "CREDENTIAL_MISSING", "SERVER_UNREACHABLE", etc.
    message: string,           // Human-readable
    public exitCode: number = 1
  ) {
    super(message)
    this.name = 'FamError'
  }
}

class ConfigError extends FamError { }       // Schema validation, parse errors
class VaultError extends FamError { }        // Keychain access, missing credentials
class DaemonError extends FamError { }       // Port conflicts, lifecycle issues
class ProxyError extends FamError { }        // Upstream errors, routing failures
class AuthError extends FamError { }         // Invalid tokens, scope violations
```

---

## 13. Security Model

### 13.1 Threat Model (local-first context)

FAM runs on a single developer machine. The primary threats are:

| Threat | Mitigation |
|---|---|
| **Secrets in plaintext config files** | OS keychain only. Never in YAML, JSON, state files, or logs. |
| **Unauthorized tool access** | Bearer tokens per profile. Scoping rules enforce which profiles can access which servers. |
| **Credential leakage in logs** | Request params hashed, not logged. Credential values never logged. Error messages sanitized. |
| **Privilege escalation across profiles** | Profile scoping is deny-by-default. A tool only sees servers in its `allowed_servers`. Denied servers return "not found." |
| **Daemon exploited via network** | Listens on localhost only. Unix socket has filesystem permissions. No remote access. |
| **Stale credentials** | `rotate_after_days` tracking. `fam status` warns. `fam validate` checks. |
| **Man-in-the-middle on upstream** | HTTPS for all remote MCP servers. Stdio is local IPC. |

### 13.2 Token Security

- Tokens are generated with `crypto.randomBytes(32)` (256 bits of entropy)
- Tokens are shown once at registration, then only stored as SHA-256 hashes
- Token format: `fam_sk_<profile_short_3chars>_<hex_64chars>` (identifiable prefix for grep/rotate)
- Tokens don't expire by default (local-only, single-user)
- `fam register --rotate` invalidates old token immediately

### 13.3 What FAM Does NOT Protect Against

- A compromised machine (if root is compromised, the keychain is too)
- A malicious MCP server upstream (FAM forwards requests — it doesn't sandbox them)
- An agent tool that ignores FAM and connects directly to upstream servers
- Side-channel attacks on the keychain

These are out of scope for a local-first CLI tool. FAM's security goal is **operational hygiene** (no secrets in config files, audit trail, access scoping) not **adversarial defense**.

---

## 14. Testing Strategy

Following The Way of the FoFo: Vitest for unit/integration, Playwright for E2E (if UI exists — CLI-only for MVP).

### 14.1 Test Layers

| Layer | Tool | What's Tested | Coverage Target |
|---|---|---|---|
| **Unit** | Vitest | Zod schema validation, diff engine, config generators (pure functions), credential injection, token hashing | All modules with pure logic |
| **Integration** | Vitest | CLI commands against real (temp) filesystem, keychain operations (mock keyring for CI), SQLite audit logging, YAML parse → plan → state roundtrip | All CLI commands, all data flows |
| **MCP Protocol** | Vitest + MCP SDK test client | Full proxy flow: connect → tools/list → tools/call → verify response. Token auth enforcement. Profile scoping (allowed/denied). Native tool responses | Core daemon functionality |
| **E2E** | Shell scripts (Vitest or bash) | `fam init` → edit YAML → `fam plan` → `fam apply` → `fam daemon start` → MCP client connects → tool call succeeds → `fam log` shows entry → `fam daemon stop` | Happy path + key error paths |

### 14.2 Test Fixtures

```
test/
├── fixtures/
│   ├── valid-config.yaml          # Full valid fam.yaml for happy-path tests
│   ├── minimal-config.yaml        # Minimum viable fam.yaml
│   ├── invalid-configs/           # Various invalid YAMLs for error tests
│   │   ├── missing-profiles.yaml
│   │   ├── bad-server-ref.yaml
│   │   └── invalid-transport.yaml
│   └── sample-state.json          # Pre-populated state for diff tests
├── mocks/
│   ├── keychain.ts                # In-memory keychain mock for CI
│   └── mcp-server.ts              # Fake upstream MCP server for proxy tests
├── unit/
│   ├── config/
│   ├── generators/
│   ├── vault/
│   └── audit/
├── integration/
│   ├── cli/
│   ├── daemon/
│   └── proxy/
└── e2e/
    └── full-cycle.test.ts
```

### 14.3 CI/CD

GitHub Actions workflow:

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }} }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

Keychain tests use an in-memory mock on CI (no OS keychain available). Real keychain tested locally.

---

## 15. Project Structure

```
fam/
├── src/
│   ├── cli/                        # CLI command handlers
│   │   ├── index.ts                # Commander program setup, global options
│   │   ├── init.ts                 # fam init
│   │   ├── plan.ts                 # fam plan
│   │   ├── apply.ts                # fam apply
│   │   ├── daemon.ts               # fam daemon start|stop|restart|status
│   │   ├── secret.ts               # fam secret set|get|list|delete
│   │   ├── register.ts             # fam register <profile>
│   │   ├── mcp-manage.ts           # fam mcp add|remove|list
│   │   ├── validate.ts             # fam validate
│   │   ├── status.ts               # fam status
│   │   └── log.ts                  # fam log [export]
│   │
│   ├── config/                     # Configuration engine
│   │   ├── schema.ts               # Zod schemas for fam.yaml
│   │   ├── parser.ts               # YAML → validated FamConfig
│   │   ├── state.ts                # state.json read/write (atomic)
│   │   ├── diff.ts                 # Desired vs current diff engine
│   │   ├── resolve.ts              # ${VAR} interpolation, ~ expansion
│   │   └── types.ts                # Shared TypeScript types
│   │
│   ├── daemon/                     # MCP proxy daemon
│   │   ├── server.ts               # Fastify setup + route registration
│   │   ├── mcp-handler.ts          # MCP SDK server: tools/list, tools/call
│   │   ├── proxy.ts                # Upstream routing + credential injection
│   │   ├── stdio-pool.ts           # Stdio child process manager
│   │   ├── upstream-manager.ts     # HTTP/SSE MCP client connections
│   │   ├── tool-registry.ts        # Unified tool registry + profile views
│   │   ├── auth.ts                 # Bearer token → profile resolution
│   │   ├── native-tools.ts         # fam__whoami, fam__log_action, etc.
│   │   └── lifecycle.ts            # PID file, daemonize, signal handlers
│   │
│   ├── generators/                 # Config file generators (pure functions)
│   │   ├── base.ts                 # GeneratorInput/Output interfaces
│   │   ├── claude-code.ts          # → ~/.claude/settings.json
│   │   ├── cursor.ts               # → ~/.cursor/mcp.json
│   │   ├── vscode.ts               # → .vscode/mcp.json
│   │   ├── openhands.ts            # → ~/.openhands/config.toml
│   │   ├── generic.ts              # → ~/.fam/configs/<profile>.json
│   │   ├── instructions.ts         # → FAM.md per profile
│   │   └── merge.ts                # I/O/S merge strategy logic
│   │
│   ├── vault/                      # Credential management
│   │   ├── keychain.ts             # @napi-rs/keyring wrapper (KeychainVault class)
│   │   ├── oauth.ts                # OAuth flow orchestration (v1, stubbed in MVP)
│   │   └── inject.ts               # Credential injection into requests
│   │
│   ├── audit/                      # Audit logging
│   │   ├── logger.ts               # AuditLogger class (better-sqlite3)
│   │   ├── schema.sql              # Table DDL + indexes
│   │   └── export.ts               # JSON/CSV export
│   │
│   ├── utils/                      # Shared utilities
│   │   ├── errors.ts               # FamError hierarchy
│   │   ├── logger.ts               # pino logger setup
│   │   ├── paths.ts                # ~/.fam resolution, path helpers
│   │   └── crypto.ts               # Token generation, SHA-256 hashing
│   │
│   └── index.ts                    # Entry point: imports cli/index.ts
│
├── test/
│   ├── fixtures/                   # Test YAML configs, state files
│   ├── mocks/                      # Keychain mock, MCP server mock
│   ├── unit/                       # Unit tests (mirrors src/ structure)
│   ├── integration/                # Integration tests
│   └── e2e/                        # End-to-end tests
│
├── fam.yaml                        # Dogfood: FAM's own config
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.js
├── .prettierrc
├── .env.example
├── .github/
│   └── workflows/
│       └── ci.yml
├── CLAUDE.md
├── README.md
└── LICENSE
```

---

## 16. Dependency Inventory

### Runtime Dependencies

| Package | Purpose | Why This One |
|---|---|---|
| `commander` | CLI framework | Simple, well-known, no magic. Migrate to `oclif` in v1 if plugins needed |
| `fastify` | HTTP server (daemon) | Fast, TypeScript-native, plugin ecosystem. Chosen over Express per CLAUDE.md |
| `@modelcontextprotocol/sdk` | MCP protocol handling | Official SDK. Handles JSON-RPC, transports, capability negotiation |
| `@napi-rs/keyring` | OS keychain access | Rust/NAPI-RS bindings to OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret). Prebuilt binaries, no native compilation. Class-based `Entry` API. v1.2.0+ |
| `better-sqlite3` | Audit log storage | Synchronous, embedded, zero-config. Perfect for local storage |
| `yaml` | YAML parsing | Official YAML 1.2 library. Robust, well-maintained |
| `zod` | Schema validation | TypeScript-first. Infer types from schemas. Great error messages |
| `json-diff` | Plan output diffs | Structured JSON diffing for human-readable plan output |
| `pino` | Structured logging | Fast, JSON-native. Pairs well with Fastify (fastify uses pino internally) |
| `chalk` | CLI output coloring | Terminal colors for plan output, status displays |
| `inquirer` | Interactive prompts | For `fam init`, `fam apply` (I/O/S prompt), `fam secret set` |

### Dev Dependencies

| Package | Purpose |
|---|---|
| `typescript` | Language |
| `vitest` | Test runner |
| `eslint` + `@typescript-eslint/*` | Linting |
| `prettier` | Formatting |
| `tsx` | TypeScript execution (dev) |
| `tsup` | Bundling for distribution |

### Deferred Dependencies (v1)

| Package | Purpose |
|---|---|
| `simple-oauth2` | OAuth2 client flows |
| `grant` | OAuth provider configs (200+ providers) |
| `chokidar` | File watching (drift detection) |
| `oclif` | CLI plugin system |

---

## 17. Build Milestones

Six phases. Each has a clear Definition of Done. Phases 1-2 have no dependencies on each other and can be parallelized.

### Phase 1: Foundation (scaffold + config engine)

**Goal:** Parse `fam.yaml`, validate it, compute diffs.

| Task | Details |
|---|---|
| Project scaffold | `package.json`, `tsconfig.json`, ESLint, Prettier, Vitest config, directory structure |
| Zod schema (`config/schema.ts`) | Full `FamConfigSchema` as specified in Section 5.1 |
| YAML parser (`config/parser.ts`) | Read YAML, validate with Zod, resolve `${VAR}` interpolation |
| State manager (`config/state.ts`) | Load/write `state.json` with atomic writes |
| Diff engine (`config/diff.ts`) | Compute structured diff between desired config and current state |
| Diff formatter | Human-readable Terraform-style plan output |
| Error types (`utils/errors.ts`) | `FamError` hierarchy |
| Path utils (`utils/paths.ts`) | `~` expansion, `~/.fam/` resolution |
| CLI skeleton (`cli/index.ts`) | Commander setup with global options |
| `fam plan` command | Parse → diff → format → print |

**DoD:**
- `fam plan` with the sample YAML from requirements doc produces correct diff output
- Zod rejects all invalid configs in `test/fixtures/invalid-configs/`
- Unit tests pass for schema, parser, diff engine

### Phase 2: Credential Vault

**Goal:** Store and retrieve secrets from the OS keychain.

| Task | Details |
|---|---|
| KeychainVault class | Wrap `@napi-rs/keyring` Entry API with `fam/<name>` convention |
| `fam secret set` | Hidden input prompt, store in keychain |
| `fam secret get` | Retrieve and print (requires `--yes`) |
| `fam secret list` | Table output with status, rotation info |
| `fam secret delete` | Remove from keychain with confirmation |
| Keychain mock for tests | In-memory implementation of `CredentialVault` interface |

**DoD:**
- `fam secret set/get/list/delete` work against real macOS Keychain
- Tests pass with in-memory mock
- Credentials never appear in logs or state files

### Phase 3: MCP Proxy Daemon

**Goal:** A running daemon that proxies MCP tool calls with auth and credential injection.

| Task | Details |
|---|---|
| Fastify server setup | TCP port + Unix socket binding |
| MCP SDK server integration | SSE transport at `/mcp` |
| Stdio process pool | Spawn, supervise, auto-restart, tools/list discovery |
| HTTP/SSE upstream manager | Connect to remote MCP servers, tools/list discovery |
| Tool registry | Unified registry with namespace prefixing, per-profile filtering |
| Auth engine | Bearer token → profile resolution |
| Proxy routing | Tool name prefix → upstream server → credential injection → forward |
| Native tools | `fam__whoami`, `fam__log_action`, `fam__list_servers`, `fam__health` |
| Session token generation | `fam register <profile>` |
| Daemon lifecycle | `fam daemon start/stop/restart/status`, PID file, signal handlers |
| `/health` endpoint | JSON health response |
| `/api/v1/reload` endpoint | Hot-reload config without restart |

**DoD:**
- Daemon starts, connects to at least one stdio MCP server (filesystem)
- MCP client can connect, call `tools/list`, receive namespaced tools
- Tool call proxied to upstream with credential injection
- Invalid token returns "unauthorized"
- Out-of-scope tool returns "not found"
- Daemon stops gracefully on SIGTERM

### Phase 4: Config Generators + Apply

**Goal:** `fam apply` writes tool-specific config files and manages the full lifecycle.

| Task | Details |
|---|---|
| Generator framework | `GeneratorInput`/`GeneratorOutput` interfaces |
| Claude Code generator | Write `~/.claude/settings.json` |
| Cursor generator | Write `~/.cursor/mcp.json` |
| VS Code generator | Write `.vscode/mcp.json` |
| OpenHands generator | Write `~/.openhands/config.toml` |
| Generic generator | Write `~/.fam/configs/<profile>.json` |
| Merge strategy (I/O/S) | Interactive first-time prompt, state tracking |
| `fam apply` command | Full flow: plan → confirm → credentials → generate → state → reload |
| `fam init` command | Interactive scaffold with config detection |
| FAM.md generator | Per-profile instruction files |
| `fam validate` command | Schema + connectivity + credential checks |

**DoD:**
- `fam init` creates valid `fam.yaml` scaffold
- `fam apply` generates correct config for all five target formats
- First-time I/O/S prompt works, strategy persists in state
- Subsequent applies are non-interactive
- `fam validate` catches missing credentials and unreachable servers

### Phase 5: Audit + Status + Polish

**Goal:** Full audit logging, status commands, error hardening.

| Task | Details |
|---|---|
| AuditLogger class | SQLite init, `logCall`, `logConfigChange` |
| Audit middleware | Log every proxied call and config change |
| `fam log` command | Query with filters |
| `fam log export` | JSON/CSV export |
| `fam status` command | Full health overview |
| `fam mcp add/remove/list` | Quick MCP server management |
| Retention cleanup | Delete entries older than `retention_days` |
| Error hardening | Cover all scenarios in Section 12.2 |
| Daemon auto-start | `fam daemon install` for launchd/systemd |

**DoD:**
- Every proxied call appears in `fam log`
- `fam status` shows accurate daemon health
- `fam log export` produces valid JSON/CSV
- All error scenarios from Section 12.2 are handled gracefully

### Phase 6: Ship

**Goal:** Production-ready release.

| Task | Details |
|---|---|
| README | Installation, quickstart, architecture diagram |
| `npm publish` setup | Package config, bin entry, prepublish build |
| Homebrew formula | Tap for macOS install |
| Dogfood | Run FAM with real MCP servers (GitHub, filesystem, n8n) |
| E2E test suite | Full init → apply → daemon → call → log → stop cycle |

**DoD:**
- `npm install -g @sweetpapatech/fam` works
- `brew install sweetpapatech/tap/fam` works
- Full dogfood cycle with real MCP servers passes
- README is complete and accurate

---

## 18. Open Questions & Decisions Log

### Resolved

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | YAML vs HCL vs TOML? | **YAML** | Most familiar to target audience. HCL adds parser dependency for minimal benefit. |
| 2 | Daemon always-on vs on-demand? | **Always-on** | Manages stdio children, holds session state. launchd/systemd for auto-start. |
| 3 | Stdio servers through proxy? | **Spawn on startup, keep alive** | MCP SDK StdioClientTransport handles framing. Map namespace → transport. Auto-restart on crash. |
| 4 | Require session tokens always? | **Yes** | One CLI command to set up. Enables per-profile scoping and meaningful audit trails. |
| 5 | Config file merge strategy? | **Three-path interactive (I/O/S)** | Import preserves existing work. Overwrite is clean. Skip is non-destructive. |
| 6 | Backend framework? | **Fastify** (not Express) | Faster, TypeScript-native, plugin ecosystem. CLAUDE.md override. |
| 7 | OAuth in MVP? | **No — API keys only** | OAuth adds complexity. Schema supports declaration now. Implementation in v1. |
| 8 | Logger? | **pino** | Fastify uses pino internally. JSON structured logging. Fast. |

 9 | Config file ownership — what if Cursor also writes to `~/.cursor/mcp.json`? | (a) Own the whole file via I/O/S strategy (b) Managed section with comment markers (c) Only manage the `fam` key, preserve everything else | **(c)** — upsert the `fam` key only. Least destructive. Other keys are the user's business. |
| 10 | Should `fam plan` check MCP server reachability? | (a) Yes, always (b) Only with `--check` flag (c) Only in `fam validate` | **(c)** — `plan` should be fast and offline. `validate` does the network checks. |
| 11 | Token storage format — raw file vs encrypted? | (a) `sessions.json` with SHA-256 hashes (b) SQLite table (c) Encrypted file | **(a)** — hashes only, simple, local-only threat model. |
| 12 | How to handle `fam apply` when daemon is not running? | (a) Auto-start daemon (b) Apply configs only, skip daemon reload (c) Warn and suggest starting | **(b)** — apply writes config files regardless. Daemon reload is a bonus. |


---

*This design document is the implementation contract. When in doubt, refer here. When this doc conflicts with `requirements-design.md`, this doc wins (it's the refined version). When this doc is silent, The Way of the FoFo applies.*

*Build the thing. Ship the thing. Iterate on the thing.*
