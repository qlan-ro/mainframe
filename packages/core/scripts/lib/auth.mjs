// Auth classification, mirroring src/server/middleware/auth.ts and
// src/server/websocket.ts. The middleware is global (one gate for the whole
// app), so per-route auth is derived from a small path allow-list rather than
// per-handler config.

/** Paths served without any token, even when AUTH_TOKEN_SECRET is set. */
export const PUBLIC_PATHS = ['/health', '/api/auth/confirm', '/api/auth/status', '/api/auth/pair-status'];

/**
 * Classify a route's auth requirement.
 * - `none`   → public path, no token ever required.
 * - `bearer` → Bearer token required for remote (non-loopback) callers;
 *              loopback (127.0.0.1 / ::1) is always allowed and only has its
 *              token attached opportunistically. Matches tryAttachAuth + the
 *              isLocalhost() bypass in createAuthMiddleware.
 *
 * When AUTH_TOKEN_SECRET is unset the middleware is a no-op and every route is
 * effectively `none`; the classification below describes the secured mode.
 */
export function classifyAuth(routePath) {
  if (PUBLIC_PATHS.includes(routePath)) {
    return { requirement: 'none', loopbackBypass: false };
  }
  return { requirement: 'bearer', loopbackBypass: true };
}

/** Global gate semantics recorded once at the top of routes.json. */
export const AUTH_MODEL = {
  secretEnv: 'AUTH_TOKEN_SECRET',
  whenSecretUnset: 'middleware is a no-op; all routes are unauthenticated',
  publicPaths: PUBLIC_PATHS,
  scheme: 'Authorization: Bearer <device token>',
  loopbackBypass: {
    ips: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    behavior: 'loopback callers are never rejected; token is validated and attached only if present',
  },
  onReject: { status: 401, body: { success: false, error: 'Unauthorized' } },
  websocket: {
    tokenSource: 'token query param on the upgrade URL',
    loopbackBypass: true,
    onReject: 'HTTP/1.1 401 Unauthorized then socket destroyed',
    forwardedFor: 'x-forwarded-for first hop is trusted only when the raw peer is loopback (cloudflared)',
  },
};
