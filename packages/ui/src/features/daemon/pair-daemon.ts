/**
 * pair-daemon — client-side logic for verifying a remote daemon and exchanging
 * a pairing code for a session token.
 *
 * All calls hit the remote URL directly with `fetch` (the daemon target is not
 * yet active, so the normal apiBase/http.ts wrappers must not be used).
 */

const STORAGE_KEY = 'mf:client-device-id';
const HEALTH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// PairingError
// ---------------------------------------------------------------------------

export type PairingErrorKind = 'invalid' | 'network';

export class PairingError extends Error {
  readonly kind: PairingErrorKind;

  constructor(kind: PairingErrorKind) {
    super(kind === 'invalid' ? 'Pairing code is invalid or expired' : 'Network error during pairing');
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

export interface VerifyResult {
  ok: boolean;
  version?: string;
  ms?: number;
}

/**
 * Probes `GET <url>/health` with a 5-second timeout.
 * Returns `{ ok: true, version?, ms }` on any 2xx; `{ ok: false }` on
 * timeout or network error — never throws.
 */
export async function verifyDaemon(url: string): Promise<VerifyResult> {
  const base = url.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    const ms = Date.now() - start;

    if (!res.ok) return { ok: false };

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const version = typeof body['version'] === 'string' ? body['version'] : undefined;

    return { ok: true, version, ms };
  } catch {
    // Intentional: AbortError (timeout) and network failures both map to ok:false.
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
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
 * POSTs `{ pairingCode, clientDeviceId, deviceName }` to `<url>/api/auth/confirm`.
 * On success returns `{ token, deviceId }` from the envelope's `data` field.
 * Throws `PairingError('invalid')` on a 401 or an envelope with `success:false`.
 * Throws `PairingError('network')` on a network/timeout failure.
 */
export async function confirmPairing(url: string, code: string, deviceName: string): Promise<PairResult> {
  const base = url.replace(/\/+$/, '');
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
