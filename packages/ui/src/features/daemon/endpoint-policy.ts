/**
 * endpoint-policy — pure predicate deciding whether a daemon endpoint may be
 * used plain (http) or requires https. No React, no fetch: callers gate on
 * this before spending a pairing code (verifyDaemon) and again at confirm
 * (confirmPairing), so a prefilled or pasted URL cannot bypass it either way.
 */
import { parseRemoteUrl, type RemoteUrlParts } from './pair-daemon';

/**
 * Hosts a plain http endpoint is trusted on. `::1` is deliberately excluded —
 * the CSP host-source grammar cannot express an IPv6 literal, so admitting it
 * here would relocate the silent failure this policy exists to prevent.
 */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];

export type EndpointRefusal = 'invalid-url' | 'insecure-host';

export type EndpointPolicyResult =
  { allowed: true; parts: RemoteUrlParts } | { allowed: false; reason: EndpointRefusal };

export const INSECURE_ENDPOINT_MESSAGE =
  'Plain http works only on this machine (127.0.0.1 or localhost). Use an https URL for any other server.';

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname.toLowerCase());
}

/**
 * Parses `url` and allows it when the scheme is https, or when the scheme is
 * http and the hostname is loopback. Everything else is refused.
 */
export function checkEndpointPolicy(url: string): EndpointPolicyResult {
  let parts: RemoteUrlParts;
  try {
    parts = parseRemoteUrl(url);
  } catch {
    return { allowed: false, reason: 'invalid-url' };
  }

  if (parts.scheme === 'https') return { allowed: true, parts };

  const hostname = new URL(parts.baseUrl).hostname;
  if (isLoopbackHostname(hostname)) return { allowed: true, parts };

  return { allowed: false, reason: 'insecure-host' };
}

/**
 * Rewrites a `localhost` hostname to `127.0.0.1`, scoped to http only —
 * doing this unconditionally would rewrite an `https://localhost` host and
 * break TLS hostname verification. Port is preserved.
 */
export function loopbackCanonicalHost(parts: RemoteUrlParts): string {
  if (parts.scheme !== 'http') return parts.host;

  const hostname = new URL(parts.baseUrl).hostname;
  if (hostname.toLowerCase() !== 'localhost') return parts.host;

  const port = new URL(parts.baseUrl).port;
  return port ? `127.0.0.1:${port}` : '127.0.0.1';
}
