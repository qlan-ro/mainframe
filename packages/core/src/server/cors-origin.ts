/**
 * Origins permitted to make cross-origin requests to the daemon.
 *
 * The daemon only ever serves localhost clients, but a desktop webview does not
 * always present an `http(s)://localhost` origin:
 *   - dev vite / Electron dev → `http://localhost:<port>` / `http://127.0.0.1:<port>`
 *   - packaged Tauri (macOS/Linux) → `tauri://localhost` custom scheme
 *   - packaged Tauri (Windows) → `http://tauri.localhost`
 *
 * A too-narrow allowlist silently omits the `Access-Control-Allow-Origin`
 * header, so WKWebView blocks every daemon response and the packaged app hangs
 * on "waiting for daemon" even though the daemon is healthy (curl, which sends
 * no Origin, is unaffected — masking the bug).
 */
const ALLOWED_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;

export function isAllowedOrigin(origin: string | undefined): origin is string {
  return typeof origin === 'string' && ALLOWED_ORIGIN.test(origin);
}
