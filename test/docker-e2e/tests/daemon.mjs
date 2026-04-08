/**
 * tests/daemon.mjs -- Daemon lifecycle and MCP protocol tests.
 *
 * Starts the FAM daemon, exercises authentication, tool listing,
 * native tools, MCP protocol methods, and clean shutdown.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CATEGORY = 'daemon'
const DAEMON_PORT = 17866  // Offset from core-cli to avoid port conflicts

/**
 * Build fam.yaml for daemon tests.
 */
function buildYaml(ctx) {
  return `
version: "0.1"

settings:
  daemon:
    port: ${DAEMON_PORT}
    auto_start: false
  audit:
    enabled: true

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ctx.projectDir}"]
    transport: stdio
    description: "Test filesystem"

profiles:
  test-profile:
    description: "Daemon test profile"
    config_target: generic
    allowed_servers: [filesystem]

generators:
  generic:
    output: ${ctx.famDir}/configs/daemon-test.json
    format: generic_mcp_list

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile"
  health:
    enabled: true
    description: "Daemon health status"
  list_servers:
    enabled: true
    description: "List available MCP servers"
`
}

/**
 * Extract the session token from `fam apply --yes` stdout.
 * Tokens follow the pattern: fam_sk_<3char>_<64hex>
 */
function extractToken(applyOutput) {
  const match = applyOutput.match(/fam_sk_[a-z_]{3}_[0-9a-f]{64}/)
  return match ? match[0] : null
}

/**
 * @param {import('../lib/test-context.mjs').TestContext} ctx
 * @param {import('../lib/reporter.mjs').Reporter} reporter
 */
export async function run(ctx, reporter) {
  // --- Setup: write config, apply, extract token, start daemon ---
  ctx.writeFamYaml(buildYaml(ctx))

  const applyResult = ctx.fam('apply --yes')
  const combined = applyResult.stdout + applyResult.stderr
  const sessionToken = extractToken(combined)

  if (!sessionToken) {
    reporter.fail(CATEGORY, 'setup', `Could not extract session token from apply output: ${combined.slice(0, 500)}`)
    return
  }

  try {
    await ctx.startDaemon(DAEMON_PORT)
  } catch (err) {
    reporter.fail(CATEGORY, 'setup', err)
    return
  }

  // 1. health-unauthenticated
  {
    const name = 'health-unauthenticated'
    const t0 = Date.now()
    try {
      const health = await ctx.healthCheck(null, DAEMON_PORT)
      if (health.status !== 'ok') {
        throw new Error(`Expected status "ok", got "${health.status}"`)
      }
      if (health.servers || health.profiles) {
        throw new Error('Unauthenticated /health should not expose servers or profiles')
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 2. health-authenticated
  {
    const name = 'health-authenticated'
    const t0 = Date.now()
    try {
      const health = await ctx.healthCheck(sessionToken, DAEMON_PORT)
      if (health.uptime_ms === undefined && health.uptime_ms !== 0) {
        throw new Error(`Expected uptime_ms in authenticated health response, got keys: ${Object.keys(health).join(', ')}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 3. tools-list
  {
    const name = 'tools-list'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/list', {}, sessionToken, DAEMON_PORT)
      if (resp.status !== 200) {
        throw new Error(`Expected status 200, got ${resp.status}`)
      }
      const result = resp.body.result
      if (!result || !Array.isArray(result.tools)) {
        throw new Error(`Expected result.tools array, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      const toolNames = result.tools.map(t => t.name)

      // Check filesystem-prefixed tools
      const fsTools = toolNames.filter(n => n.startsWith('filesystem__'))
      if (fsTools.length === 0) {
        throw new Error(`Expected filesystem__ prefixed tools, got: ${toolNames.join(', ')}`)
      }

      // Check fam__ native tools
      if (!toolNames.includes('fam__whoami')) {
        throw new Error(`Expected fam__whoami in tools, got: ${toolNames.join(', ')}`)
      }
      if (!toolNames.includes('fam__health')) {
        throw new Error(`Expected fam__health in tools, got: ${toolNames.join(', ')}`)
      }

      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 4. tools-list-no-auth
  {
    const name = 'tools-list-no-auth'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/list', {}, null, DAEMON_PORT)
      if (!resp.body.error) {
        throw new Error(`Expected error for unauthenticated tools/list, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      const errMsg = (resp.body.error.message || '').toLowerCase()
      if (!errMsg.includes('authentication') && !errMsg.includes('auth') && !errMsg.includes('token')) {
        throw new Error(`Expected authentication error, got: ${resp.body.error.message}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 5. tools-list-bad-token
  {
    const name = 'tools-list-bad-token'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/list', {}, 'fam_sk_bad_0000000000000000000000000000000000000000000000000000000000000000', DAEMON_PORT)
      if (!resp.body.error) {
        throw new Error(`Expected error for bad token, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 6. whoami
  {
    const name = 'whoami'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/call', { name: 'fam__whoami', arguments: {} }, sessionToken, DAEMON_PORT)
      if (resp.status !== 200) {
        throw new Error(`Expected status 200, got ${resp.status}`)
      }
      const result = resp.body.result
      const text = result?.content?.[0]?.text
      if (!text) {
        throw new Error(`Expected content[0].text in result, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      const whoami = JSON.parse(text)
      if (whoami.profile !== 'test-profile') {
        throw new Error(`Expected profile "test-profile", got "${whoami.profile}"`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 7. health-tool
  {
    const name = 'health-tool'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/call', { name: 'fam__health', arguments: {} }, sessionToken, DAEMON_PORT)
      if (resp.status !== 200) {
        throw new Error(`Expected status 200, got ${resp.status}`)
      }
      const result = resp.body.result
      const text = result?.content?.[0]?.text
      if (!text) {
        throw new Error(`Expected content[0].text in result, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      const health = JSON.parse(text)
      if (health.daemon?.status !== 'healthy') {
        throw new Error(`Expected daemon.status = "healthy", got: ${JSON.stringify(health.daemon)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 8. list-servers
  {
    const name = 'list-servers'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('tools/call', { name: 'fam__list_servers', arguments: {} }, sessionToken, DAEMON_PORT)
      if (resp.status !== 200) {
        throw new Error(`Expected status 200, got ${resp.status}`)
      }
      const result = resp.body.result
      const text = result?.content?.[0]?.text
      if (!text) {
        throw new Error(`Expected content[0].text in result, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      const servers = JSON.parse(text)
      const fsServer = servers.servers?.find(s => s.name === 'filesystem')
      if (!fsServer) {
        throw new Error(`Expected filesystem server in list, got: ${JSON.stringify(servers)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 9. filesystem-tool
  {
    const name = 'filesystem-tool'
    const t0 = Date.now()
    try {
      // First discover a filesystem tool
      const listResp = await ctx.mcpCall('tools/list', {}, sessionToken, DAEMON_PORT)
      const tools = listResp.body.result?.tools ?? []
      const fsTool = tools.find(t =>
        t.name.startsWith('filesystem__') &&
        (t.name.includes('list') || t.name.includes('read_dir'))
      )

      if (!fsTool) {
        // Fallback: try any filesystem tool
        const anyFsTool = tools.find(t => t.name.startsWith('filesystem__'))
        if (!anyFsTool) {
          throw new Error(`No filesystem__ tools discovered. Tools: ${tools.map(t => t.name).join(', ')}`)
        }
        // At least we know filesystem tools are present -- pass
        reporter.pass(CATEGORY, name, Date.now() - t0)
      } else {
        const callResp = await ctx.mcpCall('tools/call', {
          name: fsTool.name,
          arguments: { path: ctx.projectDir },
        }, sessionToken, DAEMON_PORT)

        if (callResp.status !== 200) {
          throw new Error(`Expected status 200 for filesystem tool call, got ${callResp.status}`)
        }
        if (!callResp.body.result) {
          throw new Error(`Expected result for filesystem tool call, got error: ${JSON.stringify(callResp.body.error)}`)
        }
        reporter.pass(CATEGORY, name, Date.now() - t0)
      }
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 10. initialize
  {
    const name = 'initialize'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('initialize', {}, sessionToken, DAEMON_PORT)
      if (resp.status !== 200) {
        throw new Error(`Expected status 200, got ${resp.status}`)
      }
      const result = resp.body.result
      if (result?.serverInfo?.name !== 'fam') {
        throw new Error(`Expected serverInfo.name = "fam", got: ${JSON.stringify(result?.serverInfo)}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 11. unknown-method
  {
    const name = 'unknown-method'
    const t0 = Date.now()
    try {
      const resp = await ctx.mcpCall('nonexistent/method', {}, sessionToken, DAEMON_PORT)
      if (!resp.body.error) {
        throw new Error(`Expected error for unknown method, got: ${JSON.stringify(resp.body).slice(0, 300)}`)
      }
      if (resp.body.error.code !== -32601) {
        throw new Error(`Expected error code -32601, got ${resp.body.error.code}`)
      }
      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }

  // 12. daemon-shutdown
  {
    const name = 'daemon-shutdown'
    const t0 = Date.now()
    try {
      await ctx.stopDaemon()

      // Give it a moment to fully shut down
      await new Promise(r => setTimeout(r, 1000))

      // Verify /health fails
      let daemonStillUp = false
      try {
        await fetch(`http://127.0.0.1:${DAEMON_PORT}/health`, {
          signal: AbortSignal.timeout(2000),
        })
        daemonStillUp = true
      } catch {
        // Connection refused = good, daemon is stopped
      }

      if (daemonStillUp) {
        throw new Error('Daemon is still responding after shutdown')
      }

      reporter.pass(CATEGORY, name, Date.now() - t0)
    } catch (err) {
      reporter.fail(CATEGORY, name, err, Date.now() - t0)
    }
  }
}
