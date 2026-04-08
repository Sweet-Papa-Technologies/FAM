/**
 * config/models.ts -- Model reference resolution.
 *
 * Parses "provider/alias" references from profile model fields,
 * looks up the provider and model alias in the models section,
 * and resolves credentials from the vault.
 */

import type {
  FamConfig,
  ModelProviderType,
  ResolvedModel,
  ResolvedModelSet,
} from './types.js'
import type { CredentialVault } from '../vault/types.js'
import { FamError } from '../utils/errors.js'

/**
 * Parse a model reference string.
 *
 * Returns { provider, alias } for "provider/alias" format.
 * Returns null for bare strings (backward compat).
 */
export function parseModelRef(ref: string): { provider: string; alias: string } | null {
  const slashIdx = ref.indexOf('/')
  if (slashIdx === -1) return null

  const provider = ref.substring(0, slashIdx)
  const alias = ref.substring(slashIdx + 1)
  if (!provider || !alias) return null

  return { provider, alias }
}

/**
 * Resolve a single model reference to a ResolvedModel.
 *
 * Looks up the provider in config.models, the alias in provider.models,
 * and fetches the credential value from the vault.
 *
 * Returns null if the reference is a bare string (no provider/alias format).
 * Throws FamError if the provider or alias doesn't exist.
 */
export async function resolveModelRef(
  ref: string,
  config: FamConfig,
  vault: CredentialVault,
  credentialCache: Map<string, string | null>,
): Promise<ResolvedModel | null> {
  const parsed = parseModelRef(ref)
  if (!parsed) return null

  const providerConfig = config.models[parsed.provider]
  if (!providerConfig) {
    throw new FamError(
      'CONFIG_INVALID',
      `Unknown model provider "${parsed.provider}" in reference "${ref}"`,
      1,
    )
  }

  const modelId = providerConfig.models[parsed.alias]
  if (!modelId) {
    throw new FamError(
      'CONFIG_INVALID',
      `Unknown model alias "${parsed.alias}" in provider "${parsed.provider}" (reference "${ref}")`,
      1,
    )
  }

  // Resolve credential (cached per provider to avoid redundant vault lookups)
  let apiKey: string | null = null
  if (providerConfig.credential) {
    if (credentialCache.has(providerConfig.credential)) {
      apiKey = credentialCache.get(providerConfig.credential) ?? null
    } else {
      apiKey = await vault.get(providerConfig.credential)
      credentialCache.set(providerConfig.credential, apiKey)
    }
  }

  return {
    provider: providerConfig.provider as ModelProviderType,
    model_id: modelId,
    api_key: apiKey,
    ...(providerConfig.base_url ? { base_url: providerConfig.base_url } : {}),
  }
}

/**
 * Resolve all model references for a profile into a ResolvedModelSet.
 *
 * Returns null if the profile has no model references that use
 * the provider/alias format.
 */
export async function resolveProfileModels(
  profileName: string,
  config: FamConfig,
  vault: CredentialVault,
): Promise<ResolvedModelSet | null> {
  const profile = config.profiles[profileName]
  if (!profile) return null

  // Cache credential lookups within this resolution pass
  const credentialCache = new Map<string, string | null>()

  // Resolve default model
  let defaultModel: ResolvedModel | null = null
  if (profile.model) {
    defaultModel = await resolveModelRef(profile.model, config, vault, credentialCache)
  }

  // Resolve role-specific models
  const roles: Record<string, ResolvedModel> = {}
  if (profile.model_roles) {
    for (const [role, ref] of Object.entries(profile.model_roles)) {
      const resolved = await resolveModelRef(ref, config, vault, credentialCache)
      if (resolved) {
        roles[role] = resolved
      }
    }
  }

  // If nothing resolved (bare strings or no model config), return null
  if (!defaultModel && Object.keys(roles).length === 0) {
    return null
  }

  // If we have roles but no explicit default, use the first role as default
  if (!defaultModel && Object.keys(roles).length > 0) {
    defaultModel = Object.values(roles)[0]
  }

  return {
    default: defaultModel!,
    roles,
  }
}
