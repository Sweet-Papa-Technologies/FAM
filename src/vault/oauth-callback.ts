/**
 * vault/oauth-callback.ts — Local callback server + browser open + code exchange.
 *
 * Spins up a temporary HTTP server on a random port to receive the
 * OAuth2 authorization callback. Opens the user's default browser
 * to the authorization URL and waits for the redirect with the
 * authorization code.
 */

import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { URL } from 'node:url'

// ─── Types ────────────────────────────────────────────────────────

export interface OAuthCallbackResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  tokenType?: string
  scope?: string
}

export interface CallbackServerResult {
  code: string
  state: string
  port: number
  close: () => void
}

// ─── Browser Open ─────────────────────────────────────────────────

/**
 * Open a URL in the system's default browser.
 *
 * Uses platform-specific commands:
 * - macOS: `open`
 * - Windows: `start`
 * - Linux: `xdg-open`
 */
export function openBrowser(url: string): void {
  const os = platform()
  const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'start' : 'xdg-open'
  exec(`${cmd} "${url}"`)
}

// ─── Callback Server ──────────────────────────────────────────────

/**
 * Render a simple HTML response page shown after the OAuth callback.
 */
function renderCallbackPage(success: boolean, message: string): string {
  const color = success ? '#22c55e' : '#ef4444'
  const icon = success ? '&#10003;' : '&#10007;'
  return `<!DOCTYPE html>
<html>
<head><title>FAM OAuth</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a1a;color:#e5e5e5;">
  <div style="text-align:center;max-width:400px;">
    <div style="font-size:48px;color:${color};margin-bottom:16px;">${icon}</div>
    <h2 style="margin:0 0 8px;">${message}</h2>
    <p style="color:#999;">You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`
}

/**
 * Start a local callback server, open the browser for OAuth authorization,
 * and wait for the callback with the authorization code.
 *
 * @param authorizeUrl - The full OAuth2 authorization URL to open in the browser
 * @param timeout - Maximum time to wait for the callback in milliseconds (default: 120s)
 * @returns Promise that resolves with the authorization code, state, port, and close function
 */
export async function startCallbackServer(
  authorizeUrl: string,
  timeout: number = 120_000,
): Promise<CallbackServerResult> {
  return new Promise<CallbackServerResult>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
    }

    const server = createServer((req, res) => {
      // Only handle GET requests to the callback path
      if (!req.url || req.method !== 'GET') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const requestUrl = new URL(req.url, `http://localhost`)

      // Check for error response from provider
      const error = requestUrl.searchParams.get('error')
      if (error) {
        const errorDescription = requestUrl.searchParams.get('error_description') ?? error
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(renderCallbackPage(false, `Authorization failed: ${errorDescription}`))
        cleanup()
        reject(new Error(`OAuth authorization failed: ${errorDescription}`))
        return
      }

      // Extract authorization code and state
      const code = requestUrl.searchParams.get('code')
      const state = requestUrl.searchParams.get('state')

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(renderCallbackPage(false, 'No authorization code received'))
        return
      }

      // Success — send response and resolve
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(renderCallbackPage(true, 'Authorization successful!'))

      cleanup()

      const address = server?.address()
      const port = typeof address === 'object' && address ? address.port : 0

      resolve({
        code,
        state: state ?? '',
        port,
        close: () => {
          server?.close()
        },
      })
    })

    // Listen on a random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      if (!address || typeof address === 'string') {
        cleanup()
        reject(new Error('Failed to start callback server'))
        return
      }

      const port = address.port
      const redirectUri = `http://127.0.0.1:${port}/callback`

      // Replace the redirect_uri placeholder in the authorize URL
      const finalUrl = authorizeUrl.includes('redirect_uri=')
        ? authorizeUrl.replace(
            /redirect_uri=[^&]*/,
            `redirect_uri=${encodeURIComponent(redirectUri)}`,
          )
        : `${authorizeUrl}${authorizeUrl.includes('?') ? '&' : '?'}redirect_uri=${encodeURIComponent(redirectUri)}`

      // Open browser
      openBrowser(finalUrl)
    })

    // Set timeout
    timeoutId = setTimeout(() => {
      server?.close()
      reject(new Error(`OAuth callback timed out after ${timeout / 1000} seconds`))
    }, timeout)

    // Handle server errors
    server.on('error', (err) => {
      cleanup()
      reject(new Error(`Callback server error: ${err.message}`))
    })
  })
}
