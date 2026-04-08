/**
 * config/index.ts -- Barrel exports for the config module.
 *
 * Re-exports everything public from schema, parser, state, diff,
 * resolve, and types so consumers can import from `../config/index.js`.
 */

// Schema (Zod validators and inferred types)
export {
  FamConfigSchema,
  CredentialSchema,
  McpServerSchema,
  HttpMcpServerSchema,
  StdioMcpServerSchema,
  ModelProviderSchema,
  ModelProviderTypeSchema,
  ProfileSchema,
  GeneratorSchema,
  NativeToolSchema,
  InstructionsSchema,
  SettingsSchema,
  DaemonSettingsSchema,
  AuditSettingsSchema,
  ApiKeyCredentialSchema,
  OAuth2CredentialSchema,
  PerProfileInstructionSchema,
} from './schema.js'

export type {
  FamConfigZod,
  CredentialConfigZod,
  McpServerConfigZod,
  ModelProviderConfigZod,
  ProfileConfigZod,
  GeneratorConfigZod,
  NativeToolConfigZod,
  InstructionsConfigZod,
  GlobalSettingsZod,
} from './schema.js'

// Parser
export { parseConfig } from './parser.js'

// State management
export { loadState, writeState, createEmptyState } from './state.js'

// Diff engine
export { computeDiff, formatDiff } from './diff.js'

// Model resolution
export { parseModelRef, resolveModelRef, resolveProfileModels } from './models.js'

// Env var resolution
export { resolveEnvVars, expandTilde } from './resolve.js'

// All types from the shared type definitions
export type {
  FamConfig,
  ApiKeyCredConfig,
  OAuthCredConfig,
  CredentialConfig,
  ModelProviderType,
  ModelProviderConfig,
  ResolvedModel,
  ResolvedModelSet,
  HttpServerConfig,
  StdioServerConfig,
  McpServerConfig,
  ProfileConfig,
  GeneratorConfig,
  NativeToolConfig,
  InstructionsConfig,
  PerProfileInstructionConfig,
  GlobalSettings,
  DaemonSettings,
  AuditSettings,
  State,
  CredentialState,
  ModelState,
  ServerState,
  ProfileState,
  GeneratedConfigState,
  PlanDiff,
  SectionDiff,
  DiffItem,
  SessionStore,
  SessionToken,
} from './types.js'
