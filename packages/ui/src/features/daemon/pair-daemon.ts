/**
 * pair-daemon — client-side logic for verifying a remote daemon and exchanging
 * a pairing code for a session token.
 *
 * All calls hit the remote URL directly with `fetch` (the daemon target is not
 * yet active, so the normal apiBase/http.ts wrappers must not be used).
 */
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { checkEndpointPolicy, INSECURE_ENDPOINT_MESSAGE } from './endpoint-policy';

const STORAGE_KEY = 'mf:client-device-id';
const HEALTH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// parseRemoteUrl
// ---------------------------------------------------------------------------

export interface RemoteUrlParts {
  /** Bare `host[:port]` with no scheme or path — safe to store as DaemonMeta.host. */
  host: string;
  /** `scheme://host[:port]` with no trailing slash or path — ready for use as a fetch base URL. */
  baseUrl: string;
  /** The scheme the URL was parsed with — `http` only when the input said so explicitly. */
  scheme: 'http' | 'https';
}

/**
 * Normalizes any user-typed daemon URL into a canonical `{ host, baseUrl, scheme }` triple.
 *
 * - If the input has no `http://` or `https://` scheme, `https://` is prepended.
 * - `baseUrl` is always the *origin* only (`scheme://host[:port]`), with no path or trailing slash.
 * - An explicit `http://` scheme is preserved (no forced upgrade to https).
 * - Throws a descriptive `Error` when the input cannot be parsed as a URL.
 */
export function parseRemoteUrl(input: string): RemoteUrlParts {
  const trimmed = input.trim();
  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let u: URL;
  try {
    u = new URL(prefixed);
  } catch {
    throw new Error(`Invalid daemon URL: "${input}"`);
  }

  const scheme = u.protocol.slice(0, -1) as 'http' | 'https';
  return { host: u.host, baseUrl: u.origin, scheme };
}

/**
 * Reconstructs the origin a stored `DaemonMeta` was paired with. An absent
 * `scheme` means https — the one place that "pre-change registry entry" fact
 * is encoded, so every reconstruction site reads it from here.
 */
export function daemonOrigin(meta: Pick<DaemonMeta, 'host' | 'scheme'>): string {
  return `${meta.scheme ?? 'https'}://${meta.host}`;
}

// ---------------------------------------------------------------------------
// PairingError
// ---------------------------------------------------------------------------

export type PairingErrorKind = 'invalid' | 'network' | 'insecure';

const PAIRING_ERROR_MESSAGES: Record<PairingErrorKind, string> = {
  invalid: 'Pairing code is invalid or expired',
  network: 'Network error during pairing',
  insecure: INSECURE_ENDPOINT_MESSAGE,
};

export class PairingError extends Error {
  readonly kind: PairingErrorKind;

  constructor(kind: PairingErrorKind) {
    super(PAIRING_ERROR_MESSAGES[kind]);
    this.name = 'PairingError';
    this.kind = kind;
    Error.captureStackTrace?.(this, PairingError);
  }
}

// ---------------------------------------------------------------------------
// Stable per-install device UUID
// ---------------------------------------------------------------------------

/**
 * Returns a stable UUID for this installation, generated once via
 * `crypto.randomUUID()` and persisted in localStorage under `mf:client-device-id`.
 * The server validates this as a UUID, so it must be a real v4 UUID.
 */
export function getOrCreateClientDeviceId(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

// ---------------------------------------------------------------------------
// verifyDaemon
// ---------------------------------------------------------------------------

export type VerifyResult =
  { ok: true; version?: string; ms?: number } | { ok: false; reason: 'refused-insecure' | 'unreachable' };

async function fetchHealth(base: string): Promise<VerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    const ms = Date.now() - start;

    if (!res.ok) return { ok: false, reason: 'unreachable' };

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const version = typeof body['version'] === 'string' ? body['version'] : undefined;

    return { ok: true, version, ms };
  } catch {
    // Intentional: AbortError (timeout) and network failures both map to unreachable.
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes `GET <baseUrl>/health` with a 5-second timeout.
 * Accepts any user-typed URL (with or without a scheme) — gated through
 * `checkEndpointPolicy` before fetching, so a non-loopback http host never
 * spends the request. Returns `{ ok: true, version?, ms }` on any 2xx;
 * `{ ok: false, reason }` on refusal, timeout, parse error, or network
 * error — never throws.
 */
export async function verifyDaemon(url: string): Promise<VerifyResult> {
  const policy = checkEndpointPolicy(url);
  if (!policy.allowed) {
    return { ok: false, reason: policy.reason === 'insecure-host' ? 'refused-insecure' : 'unreachable' };
  }

  return fetchHealth(policy.parts.baseUrl);
}

// ---------------------------------------------------------------------------
// confirmPairing
// ---------------------------------------------------------------------------

export interface PairResult {
  token: string;
  deviceId: string;
}

interface ConfirmEnvelope {
  success: boolean;
  data?: { token?: string; deviceId?: string };
}

/**
 * Exchanges a pairing code for a session token.
 *
 * POSTs `{ pairingCode, clientDeviceId, deviceName }` to `<baseUrl>/api/auth/confirm`.
 * Gated through `checkEndpointPolicy` — any scheme/path oddities are fixed and a
 * non-loopback http host never spends the request.
 * On success returns `{ token, deviceId }` from the envelope's `data` field.
 * Throws `PairingError('invalid')` on a 401 or an envelope with `success:false`.
 * Throws `PairingError('insecure')` when the endpoint policy refuses the host.
 * Throws `PairingError('network')` on an unparseable URL or a network/timeout failure.
 */
export async function confirmPairing(url: string, code: string, deviceName: string): Promise<PairResult> {
  const policy = checkEndpointPolicy(url);
  if (!policy.allowed) {
    throw new PairingError(policy.reason === 'insecure-host' ? 'insecure' : 'network');
  }
  const base = policy.parts.baseUrl;
  const clientDeviceId = getOrCreateClientDeviceId();

  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code, clientDeviceId, deviceName }),
    });
  } catch {
    // Network failure or AbortError — intentionally mapped to PairingError('network').
    throw new PairingError('network');
  }

  if (!res.ok) {
    throw new PairingError('invalid');
  }

  const envelope = (await res.json().catch(() => ({ success: false }))) as ConfirmEnvelope;

  if (!envelope.success || !envelope.data?.token || !envelope.data?.deviceId) {
    throw new PairingError('invalid');
  }

  return { token: envelope.data.token, deviceId: envelope.data.deviceId };
}
