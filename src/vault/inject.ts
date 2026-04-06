/**
 * vault/inject.ts — Pure credential injection function.
 *
 * Takes a credential value and an injection method, returns an
 * InjectedRequest with the credential placed in the appropriate
 * transport slot (HTTP header, environment variable, or query parameter).
 */

import type { InjectedRequest } from './types.js'

export interface InjectConfig {
  headerName?: string
  envVar?: string
  queryParam?: string
}

export function injectCredential(
  credentialValue: string,
  method: 'header' | 'env' | 'query',
  config?: InjectConfig,
): InjectedRequest {
  switch (method) {
    case 'header':
      return {
        headers: {
          [config?.headerName ?? 'Authorization']: `Bearer ${credentialValue}`,
        },
      }

    case 'env':
      return {
        env: {
          [config?.envVar ?? 'API_KEY']: credentialValue,
        },
      }

    case 'query':
      return {
        queryParams: {
          [config?.queryParam ?? 'token']: credentialValue,
        },
      }
  }
}
