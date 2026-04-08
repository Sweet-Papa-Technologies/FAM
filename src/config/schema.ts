/**
 * config/schema.ts -- Zod schemas for fam.yaml validation.
 *
 * This is the core data model. Every field matches DESIGN.md Section 5.1.
 * The inferred TypeScript types are re-exported alongside the schemas so
 * that consumers can import either the runtime validator OR the static type.
 */

import { z } from 'zod'

// ─── Credentials ───────────────────────────────────────────────

export const ApiKeyCredentialSchema = z.object({
  type: z.literal('api_key'),
  description: z.string(),
  env_var: z.string().optional(),
  rotate_after_days: z.number().int().positive().optional(),
})

export const OAuth2CredentialSchema = z.object({
  type: z.literal('oauth2'),
  description: z.string(),
  provider: z.string(),
  client_id: z.string(),
  scopes: z.array(z.string()),
})

export const CredentialSchema = z.discriminatedUnion('type', [
  ApiKeyCredentialSchema,
  OAuth2CredentialSchema,
])

// ─── MCP Servers ───────────────────────────────────────────────

export const HttpMcpServerSchema = z.object({
  url: z.string().url(),
  transport: z.enum(['sse', 'streamable_http']),
  credential: z.string().nullable(),
  description: z.string(),
  headers: z.record(z.string()).optional(),
})

export const StdioMcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  transport: z.literal('stdio'),
  credential: z.string().nullable().optional(),
  description: z.string(),
  env: z.record(z.string()).optional(),
})

export const McpServerSchema = z.union([HttpMcpServerSchema, StdioMcpServerSchema])

// ─── Model Providers ──────────────────────────────────────────

export const ModelProviderTypeSchema = z.enum([
  'anthropic', 'openai', 'openai_compatible', 'google', 'amazon_bedrock',
])

export const ModelProviderSchema = z.object({
  provider: ModelProviderTypeSchema,
  credential: z.string().nullable(),
  base_url: z.string().url().optional(),
  models: z.record(z.string()),
})

// ─── Profiles ──────────────────────────────────────────────────

export const ProfileSchema = z.object({
  description: z.string(),
  config_target: z.string(),
  model: z.string().optional(),
  model_roles: z.record(z.string()).optional(),
  allowed_servers: z.array(z.string()),
  denied_servers: z.array(z.string()).default([]),
  env_inject: z.record(z.string()).optional(),
  max_tools: z.number().int().positive().optional(),
})

// ─── Generators ────────────────────────────────────────────────

export const GeneratorSchema = z.object({
  output: z.string(),
  format: z.string(),
})

// ─── Native Tools ──────────────────────────────────────────────

export const NativeToolSchema = z.object({
  enabled: z.boolean().default(true),
  description: z.string(),
})

// ─── Instructions ──────────────────────────────────────────────

export const PerProfileInstructionSchema = z.object({
  extra_context: z.string().optional(),
  inject_into: z.string().optional(),
})

export const InstructionsSchema = z.object({
  enabled: z.boolean().default(true),
  output_dir: z.string().default('~/.fam/instructions/'),
  per_profile: z.record(PerProfileInstructionSchema).optional(),
})

// ─── Settings ──────────────────────────────────────────────────

export const DaemonSettingsSchema = z.object({
  port: z.number().int().default(7865),
  socket: z.string().default('~/.fam/agent.sock'),
  auto_start: z.boolean().default(true),
})

export const AuditSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  retention_days: z.number().int().positive().default(90),
  export_format: z.enum(['json', 'csv']).default('json'),
})

export const SettingsSchema = z.object({
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
}).superRefine((data, ctx) => {
  // Validate model provider credential references
  for (const [providerName, provider] of Object.entries(data.models)) {
    if (provider.credential && !data.credentials[provider.credential]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model provider "${providerName}" references unknown credential "${provider.credential}"`,
        path: ['models', providerName, 'credential'],
      })
    }
  }

  // Validate profile model references (provider/alias format)
  for (const [profileName, profile] of Object.entries(data.profiles)) {
    const refs: Array<{ field: string; value: string }> = []
    if (profile.model?.includes('/')) {
      refs.push({ field: 'model', value: profile.model })
    }
    if (profile.model_roles) {
      for (const [role, ref] of Object.entries(profile.model_roles)) {
        if (ref.includes('/')) {
          refs.push({ field: `model_roles.${role}`, value: ref })
        }
      }
    }

    for (const { field, value } of refs) {
      const [providerName, alias] = value.split('/', 2)
      const provider = data.models[providerName]
      if (!provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile "${profileName}" references unknown model provider "${providerName}" in ${field}`,
          path: ['profiles', profileName, field],
        })
      } else if (!provider.models[alias]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile "${profileName}" references unknown model alias "${alias}" in provider "${providerName}" (${field})`,
          path: ['profiles', profileName, field],
        })
      }
    }
  }
})

// ─── Inferred Types ────────────────────────────────────────────

export type FamConfigZod = z.infer<typeof FamConfigSchema>
export type CredentialConfigZod = z.infer<typeof CredentialSchema>
export type McpServerConfigZod = z.infer<typeof McpServerSchema>
export type ModelProviderConfigZod = z.infer<typeof ModelProviderSchema>
export type ProfileConfigZod = z.infer<typeof ProfileSchema>
export type GeneratorConfigZod = z.infer<typeof GeneratorSchema>
export type NativeToolConfigZod = z.infer<typeof NativeToolSchema>
export type InstructionsConfigZod = z.infer<typeof InstructionsSchema>
export type GlobalSettingsZod = z.infer<typeof SettingsSchema>
