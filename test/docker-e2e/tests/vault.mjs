/**
 * tests/vault.mjs -- Vault (gnome-keyring) integration tests.
 *
 * Tests the @napi-rs/keyring Entry class directly, which is the same
 * native module FAM uses for credential storage. This verifies the
 * Docker gnome-keyring setup is working correctly.
 *
 * Note: gnome-keyring behavior varies — some versions return empty string
 * for deleted/nonexistent keys instead of throwing. We handle both cases.
 */

const CATEGORY = 'vault'

/**
 * Try to get a password. Returns the value, or null if the key doesn't exist.
 * Handles both throwing and empty-string behaviors across keyring implementations.
 */
function safeGetPassword(entry) {
  try {
    const result = entry.getPassword()
    // Some keyring implementations return empty string for missing keys
    if (result === '' || result === null || result === undefined) return null
    return result
  } catch {
    return null
  }
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} ctx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(ctx, reporter) {
  let Entry

  // Import the native keyring module
  try {
    const keyring = await import('@napi-rs/keyring')
    Entry = keyring.Entry
    if (!Entry) {
      reporter.skip(CATEGORY, 'vault-import', 'Could not resolve Entry class from @napi-rs/keyring')
      return
    }
  } catch (err) {
    reporter.skip(CATEGORY, 'vault-import', `@napi-rs/keyring not available: ${err.message}`)
    return
  }

  // 1. vault-set-get -- Set a credential and read it back
  {
    const name = 'vault-set-get'
    const t0 = Date.now()
    try {
      const entry = new Entry('fam-e2e-test', 'test-credential')
      entry.setPassword('test-value-123')
      const result = safeGetPassword(entry)

      if (result !== 'test-value-123') {
        throw new Error(`Expected "test-value-123", got "${result}"`)
      }

      // Cleanup
      try { entry.deletePassword() } catch { /* best effort */ }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 2. vault-overwrite -- Set, overwrite, verify new value
  {
    const name = 'vault-overwrite'
    const t0 = Date.now()
    try {
      const entry = new Entry('fam-e2e-test', 'overwrite-test')
      entry.setPassword('original-value')
      entry.setPassword('updated-value')
      const result = safeGetPassword(entry)

      if (result !== 'updated-value') {
        throw new Error(`Expected "updated-value", got "${result}"`)
      }

      try { entry.deletePassword() } catch { /* best effort */ }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 3. vault-delete -- Set, delete, verify gone
  {
    const name = 'vault-delete'
    const t0 = Date.now()
    try {
      const entry = new Entry('fam-e2e-test', 'delete-test')
      entry.setPassword('will-be-deleted')
      entry.deletePassword()

      const result = safeGetPassword(entry)
      if (result !== null) {
        throw new Error(`Expected null after deletion, got "${result}"`)
      }

      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 4. vault-multiple -- Set 3 credentials, verify all exist
  {
    const name = 'vault-multiple'
    const t0 = Date.now()
    try {
      const entries = [
        { key: 'multi-1', value: 'alpha' },
        { key: 'multi-2', value: 'beta' },
        { key: 'multi-3', value: 'gamma' },
      ]

      // Set all
      for (const e of entries) {
        const entry = new Entry('fam-e2e-test', e.key)
        entry.setPassword(e.value)
      }

      // Verify all
      for (const e of entries) {
        const entry = new Entry('fam-e2e-test', e.key)
        const result = safeGetPassword(entry)
        if (result !== e.value) {
          throw new Error(`Expected "${e.value}" for key "${e.key}", got "${result}"`)
        }
      }

      // Cleanup all
      for (const e of entries) {
        try { new Entry('fam-e2e-test', e.key).deletePassword() } catch { /* best effort */ }
      }

      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 5. vault-not-found -- Read a nonexistent credential
  {
    const name = 'vault-not-found'
    const t0 = Date.now()
    try {
      const entry = new Entry('fam-e2e-test', 'nonexistent-credential-xyz')
      const result = safeGetPassword(entry)

      if (result !== null) {
        throw new Error(`Expected null for nonexistent credential, got "${result}"`)
      }

      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }
}
