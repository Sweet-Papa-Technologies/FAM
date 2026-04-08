/**
 * test-context.mjs -- Isolated test environment for each E2E category.
 *
 * Creates a temp directory with a .fam/ subdir, provides helpers for
 * running the FAM CLI, reading generated configs, and managing the daemon.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execSync, spawn } from 'node:child_process'
import { parse as parseYaml } from 'yaml'

export class TestContext {
  /**
   * @param {string} category -- category name (used in temp dir naming)
   * @param {object} config   -- parsed e2e-config.yaml
   */
  constructor(category, config) {
    const suffix = randomBytes(4).toString('hex')
    this._projectDir = join(tmpdir(), `fam-e2e-${category}-${suffix}`)
    this._famDir = join(this._projectDir, '.fam')
    this._configPath = join(this._projectDir, 'fam.yaml')
    this._config = config
    this._daemonProc = null
    this._daemonPort = null

    mkdirSync(this._famDir, { recursive: true })
  }

  /** Absolute path to the .fam/ state directory */
  get famDir() {
    return this._famDir
  }

  /** Absolute path to the fam.yaml config file */
  get configPath() {
    return this._configPath
  }

  /** Absolute path to the temp project root */
  get projectDir() {
    return this._projectDir
  }

  /** The parsed e2e-config.yaml */
  get config() {
    return this._config
  }

  /**
   * Run a FAM CLI command.
   *
   * Uses the globally-linked `fam` binary (installed via npm link in Docker).
   * Returns { exitCode, stdout, stderr } -- never throws on non-zero exit.
   *
   * @param {string} args -- CLI arguments, e.g. 'plan' or 'apply --yes'
   * @returns {{ exitCode: number, stdout: string, stderr: string }}
   */
  fam(args) {
    const cmd = `fam ${args} --config ${this._configPath} --fam-dir ${this._famDir}`
    try {
      const stdout = execSync(cmd, {
        cwd: this._projectDir,
        encoding: 'utf-8',
        timeout: this._config.runtime?.timeout_per_test_ms ?? 30000,
        env: {
          ...process.env,
          FAM_LOG_LEVEL: 'silent',
          FAM_HOME: this._famDir,
          NO_COLOR: '1',
          HOME: process.env.HOME,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return { exitCode: 0, stdout, stderr: '' }
    } catch (err) {
      return {
        exitCode: err.status ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
      }
    }
  }

  /**
   * Write fam.yaml content to the temp project directory.
   * @param {string} yamlContent
   */
  writeFamYaml(yamlContent) {
    writeFileSync(this._configPath, yamlContent, 'utf-8')
  }

  /**
   * Read and parse a generated config file.
   * Automatically detects format from extension.
   *
   * @param {string} absPath -- absolute path to the generated file
   * @returns {{ raw: string, parsed: object|null, format: string }}
   */
  readGeneratedConfig(absPath) {
    if (!existsSync(absPath)) {
      return { raw: '', parsed: null, format: 'unknown' }
    }

    const raw = readFileSync(absPath, 'utf-8')

    if (absPath.endsWith('.json')) {
      try {
        return { raw, parsed: JSON.parse(raw), format: 'json' }
      } catch {
        return { raw, parsed: null, format: 'json' }
      }
    }

    if (absPath.endsWith('.yaml') || absPath.endsWith('.yml')) {
      try {
        return { raw, parsed: parseYaml(raw), format: 'yaml' }
      } catch {
        return { raw, parsed: null, format: 'yaml' }
      }
    }

    if (absPath.endsWith('.toml')) {
      // TOML: return raw text only -- callers check for section headers
      return { raw, parsed: null, format: 'toml' }
    }

    return { raw, parsed: null, format: 'unknown' }
  }

  /**
   * Start the FAM daemon in foreground mode.
   *
   * Spawns `fam daemon start --foreground`, then polls /health until the
   * server is ready (30s timeout).
   *
   * @param {number} port -- port to run the daemon on
   * @returns {Promise<import('node:child_process').ChildProcess>}
   */
  async startDaemon(port) {
    this._daemonPort = port

    this._daemonProc = spawn(
      'fam',
      ['daemon', 'start', '--foreground', '--config', this._configPath, '--fam-dir', this._famDir],
      {
        cwd: this._projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FAM_LOG_LEVEL: 'warn',
          FAM_HOME: this._famDir,
          NO_COLOR: '1',
          HOME: process.env.HOME,
        },
        detached: false,
      },
    )

    // Collect output for debug on failure
    let stdout = ''
    let stderr = ''
    this._daemonProc.stdout?.on('data', (d) => { stdout += d.toString() })
    this._daemonProc.stderr?.on('data', (d) => { stderr += d.toString() })

    // Poll /health until ready
    const deadline = Date.now() + 30_000
    let ready = false

    while (Date.now() < deadline && !ready) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`)
        if (resp.ok) ready = true
      } catch {
        // Not ready yet
      }
    }

    if (!ready) {
      console.error('Daemon failed to start. stdout:', stdout)
      console.error('Daemon stderr:', stderr)
      throw new Error(`Daemon did not become ready within 30s on port ${port}`)
    }

    return this._daemonProc
  }

  /**
   * Stop the running daemon process.
   * Sends SIGTERM, waits up to 5s, then SIGKILL.
   */
  async stopDaemon() {
    if (!this._daemonProc || this._daemonProc.killed) return

    this._daemonProc.kill('SIGTERM')

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this._daemonProc && !this._daemonProc.killed) {
          this._daemonProc.kill('SIGKILL')
        }
        resolve()
      }, 5000)

      this._daemonProc.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this._daemonProc = null
  }

  /**
   * Make a JSON-RPC call to the daemon /mcp endpoint.
   *
   * @param {string} method -- JSON-RPC method name
   * @param {object} params -- method parameters
   * @param {string} [token] -- Bearer token
   * @param {number} [port] -- override port
   * @returns {Promise<{ status: number, body: object }>}
   */
  async mcpCall(method, params = {}, token = null, port = null) {
    const p = port ?? this._daemonPort ?? 17865
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const resp = await fetch(`http://127.0.0.1:${p}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })

    let body
    try {
      body = await resp.json()
    } catch {
      body = {}
    }

    return { status: resp.status, body }
  }

  /**
   * GET /health from the daemon.
   *
   * @param {string} [token] -- optional Bearer token
   * @param {number} [port] -- override port
   * @returns {Promise<object>}
   */
  async healthCheck(token = null, port = null) {
    const p = port ?? this._daemonPort ?? 17865
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const resp = await fetch(`http://127.0.0.1:${p}/health`, { headers })
    return await resp.json()
  }

  /**
   * Remove the temp directory and kill the daemon if it is running.
   */
  cleanup() {
    // Kill daemon first (synchronously safe -- stopDaemon is async but we do best-effort here)
    if (this._daemonProc && !this._daemonProc.killed) {
      try {
        this._daemonProc.kill('SIGKILL')
      } catch {
        // already dead
      }
      this._daemonProc = null
    }

    // Remove temp directory
    try {
      rmSync(this._projectDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
}
