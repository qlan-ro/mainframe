// Small shared helpers for the differential harness: HTTP against a loopback
// daemon, free-port discovery, sleep, and a clean child-process environment.
import net from 'node:net';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Grab an ephemeral free TCP port by binding :0 and reading it back. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * A daemon-spawn environment stripped of ambient pollution. VITE_* and the
 * daemon knobs are removed so a developer's shell can't poison the run; callers
 * layer DAEMON_PORT / MAINFRAME_DATA_DIR back on top.
 */
export function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_')) delete env[key];
  }
  delete env.DAEMON_PORT;
  delete env.MAINFRAME_DATA_DIR;
  delete env.AUTH_TOKEN_SECRET;
  delete env.LOG_LEVEL;
  return { ...env, ...extra };
}

/**
 * JSON HTTP request against a loopback daemon. Never throws on non-2xx.
 * `headers` layers extra request headers (e.g. `Origin` for CORS probes); the
 * returned `headers` is a lowercased map of the response headers so the harness
 * can diff header-level surfaces (e.g. the `Access-Control-Allow-Origin` echo).
 */
export async function req(baseUrl, method, path, { body, query, headers } = {}) {
  let url = baseUrl + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const init = { method, headers: { ...(headers ?? {}) } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed;
  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { __unparseable__: text };
    }
  } else {
    // Non-JSON (raw text, empty 204) — keep the raw body so we can still diff.
    parsed = text === '' ? null : { __raw__: text };
  }
  const respHeaders = {};
  for (const [k, v] of res.headers) respHeaders[k.toLowerCase()] = v;
  return { status: res.status, contentType: ctype.split(';')[0] || '', body: parsed, headers: respHeaders };
}

/** Poll GET /health until it answers 200 or the deadline passes. */
export async function waitForHealth(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'never responded';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return true;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(200);
  }
  throw new Error(`health check timed out for ${baseUrl}: ${lastErr}`);
}
