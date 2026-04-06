/**
 * utils/errors.ts — FAM error type hierarchy.
 *
 * All FAM errors extend FamError, which carries a machine-readable
 * code, a human-readable message, and a process exit code.
 * Based on DESIGN.md Section 12.3.
 */

export class FamError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode: number = 1,
  ) {
    super(message)
    this.name = 'FamError'
  }
}

export class ConfigError extends FamError {
  constructor(code: string, message: string) {
    super(code, message, 1)
    this.name = 'ConfigError'
  }
}

export class VaultError extends FamError {
  constructor(code: string, message: string) {
    super(code, message, 1)
    this.name = 'VaultError'
  }
}

export class DaemonError extends FamError {
  constructor(code: string, message: string) {
    super(code, message, 1)
    this.name = 'DaemonError'
  }
}

export class ProxyError extends FamError {
  constructor(code: string, message: string) {
    super(code, message, 1)
    this.name = 'ProxyError'
  }
}

export class AuthError extends FamError {
  constructor(code: string, message: string) {
    super(code, message, 1)
    this.name = 'AuthError'
  }
}
