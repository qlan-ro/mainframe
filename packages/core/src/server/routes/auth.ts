import { Router } from 'express';
import { z } from 'zod';
import { generateToken, generatePairingCode } from '../../auth/token.js';
import { validateAuthedToken } from '../../auth/validate-authed-token.js';
import type { PushService } from '../../push/push-service.js';
import type { DevicesRepository } from '../../db/devices.js';

interface PendingPairing {
  deviceName: string;
  code: string;
  createdAt: number;
  failedAttempts: number;
}

interface RateLimitEntry {
  failures: number;
  windowStart: number;
}

interface RecentPairing {
  deviceId: string;
  deviceName: string;
  consumedAt: number;
}

const pendingPairings = new Map<string, PendingPairing>();
const confirmRateLimit = new Map<string, RateLimitEntry>();
const recentPairings = new Map<string, RecentPairing>();

const PAIRING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PAIRING_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_FAILURES = 10;
const RECENT_PAIRING_TTL_MS = 60 * 1000;

function cleanRecentPairings(): void {
  const now = Date.now();
  for (const [code, entry] of recentPairings) {
    if (now - entry.consumedAt > RECENT_PAIRING_TTL_MS) recentPairings.delete(code);
  }
}

function cleanExpiredPairings(): void {
  const now = Date.now();
  for (const [key, pairing] of pendingPairings) {
    if (now - pairing.createdAt > PAIRING_EXPIRY_MS) {
      pendingPairings.delete(key);
    }
  }
  for (const [ip, entry] of confirmRateLimit) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      confirmRateLimit.delete(ip);
    }
  }
  cleanRecentPairings();
}

function isRateLimited(ip: string): boolean {
  const entry = confirmRateLimit.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    confirmRateLimit.delete(ip);
    return false;
  }
  return entry.failures >= RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = confirmRateLimit.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    confirmRateLimit.set(ip, { failures: 1, windowStart: now });
  } else {
    entry.failures++;
  }
}

export interface AuthRouteOptions {
  pushService?: PushService;
  devicesRepo?: DevicesRepository;
}

/** Exported for testing only — clears rate limit and pairing state. */
export function _resetAuthState(): void {
  pendingPairings.clear();
  confirmRateLimit.clear();
  recentPairings.clear();
}

const pairStatusQuerySchema = z.object({ code: z.string().regex(/^[A-Z0-9]{6}$/) });

const confirmBodySchema = z.object({
  pairingCode: z.string().min(1),
  deviceName: z.string().min(1).optional(),
  clientDeviceId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
});

const registerPushSchema = z.object({
  deviceId: z.string().min(1),
  pushToken: z.string().min(1),
});

export function authRoutes(options?: AuthRouteOptions): Router {
  const router = Router();

  router.post('/api/auth/pair', (req, res) => {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret) {
      res.status(400).json({ success: false, error: 'Auth not configured' });
      return;
    }

    const code = generatePairingCode();

    pendingPairings.set(code, { deviceName: 'Unknown Device', code, createdAt: Date.now(), failedAttempts: 0 });
    cleanExpiredPairings();

    res.json({ success: true, data: { pairingCode: code } });
  });

  router.post('/api/auth/confirm', (req, res) => {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret) {
      res.status(400).json({ success: false, error: 'Auth not configured' });
      return;
    }

    const ip = req.ip ?? 'unknown';
    if (isRateLimited(ip)) {
      res.status(429).json({ success: false, error: 'Too many attempts, try again later' });
      return;
    }

    const parsed = confirmBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid request body' });
      return;
    }
    const { pairingCode, deviceName, clientDeviceId } = parsed.data;

    cleanExpiredPairings();

    const pairing = pendingPairings.get(pairingCode);
    if (!pairing || Date.now() - pairing.createdAt > PAIRING_EXPIRY_MS) {
      pendingPairings.delete(pairingCode);
      recordFailure(ip);
      res.status(401).json({ success: false, error: 'Invalid or expired pairing code' });
      return;
    }

    pairing.failedAttempts++;
    if (pairing.failedAttempts > MAX_PAIRING_ATTEMPTS) {
      pendingPairings.delete(pairingCode);
      recordFailure(ip);
      res.status(401).json({ success: false, error: 'Too many failed attempts, pairing code invalidated' });
      return;
    }

    pendingPairings.delete(pairingCode);

    const deviceId = `mobile-${clientDeviceId}`;
    const name = deviceName ?? pairing.deviceName;

    options?.devicesRepo?.add(deviceId, name);
    const epoch = options?.devicesRepo?.incrementAuthEpoch(deviceId) ?? 0;

    const token = generateToken(secret, deviceId, epoch);

    recentPairings.set(pairingCode, { deviceId, deviceName: name, consumedAt: Date.now() });

    res.json({ success: true, data: { token, deviceId } });
  });

  router.get('/api/auth/status', (req, res) => {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret) {
      res.json({ success: true, data: { valid: true, authEnabled: false } });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.json({ success: true, data: { valid: false } });
      return;
    }

    if (!options?.devicesRepo) {
      res.json({ success: true, data: { valid: false } });
      return;
    }

    const payload = validateAuthedToken(secret, authHeader.slice(7), options.devicesRepo);
    res.json({
      success: true,
      data: { valid: !!payload, deviceId: payload?.deviceId },
    });
  });

  router.post('/api/auth/register-push', (req, res) => {
    if (!req.auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const parsed = registerPushSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Missing deviceId or pushToken' });
      return;
    }
    const { deviceId, pushToken } = parsed.data;
    if (deviceId !== req.auth.deviceId) {
      res.status(403).json({ success: false, error: 'Device mismatch' });
      return;
    }
    options?.pushService?.registerDevice(deviceId, pushToken);
    res.json({ success: true });
  });

  router.get('/api/auth/devices', (_req, res) => {
    const devices = options?.devicesRepo?.getAll() ?? [];
    res.json({ success: true, data: devices });
  });

  router.delete('/api/auth/devices/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    options?.devicesRepo?.remove(deviceId);
    options?.pushService?.unregisterDevice(deviceId);
    res.json({ success: true });
  });

  router.get('/api/auth/pair-status', (req, res) => {
    const parsed = pairStatusQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }
    cleanRecentPairings();
    const entry = recentPairings.get(parsed.data.code);
    if (!entry) {
      res.json({ success: true, data: { paired: false } });
      return;
    }
    res.json({
      success: true,
      data: { paired: true, deviceId: entry.deviceId, deviceName: entry.deviceName },
    });
  });

  return router;
}
