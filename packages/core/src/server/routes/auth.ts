import { Router } from 'express';
import { generateToken, validateToken, generatePairingCode } from '../../auth/token.js';
import type { PushService } from '../../push/push-service.js';
import type { DevicesRepository } from '../../db/devices.js';

interface PendingPairing {
  deviceName: string;
  code: string;
  createdAt: number;
}

const pendingPairings = new Map<string, PendingPairing>();
const PAIRING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpiredPairings(): void {
  const now = Date.now();
  for (const [key, pairing] of pendingPairings) {
    if (now - pairing.createdAt > PAIRING_EXPIRY_MS) {
      pendingPairings.delete(key);
    }
  }
}

export interface AuthRouteOptions {
  pushService?: PushService;
  devicesRepo?: DevicesRepository;
}

export function authRoutes(options?: AuthRouteOptions): Router {
  const router = Router();

  router.post('/api/auth/pair', (req, res) => {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret) {
      res.status(400).json({ success: false, error: 'Auth not configured. Set AUTH_TOKEN_SECRET.' });
      return;
    }

    const deviceName = (req.body as { deviceName?: string }).deviceName ?? 'Unknown Device';
    const code = generatePairingCode();

    pendingPairings.set(code, { deviceName, code, createdAt: Date.now() });
    cleanExpiredPairings();

    res.json({ success: true, data: { pairingCode: code } });
  });

  router.post('/api/auth/confirm', (req, res) => {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret) {
      res.status(400).json({ success: false, error: 'Auth not configured' });
      return;
    }

    const { pairingCode } = req.body as { pairingCode?: string };
    if (!pairingCode) {
      res.status(400).json({ success: false, error: 'Missing pairingCode' });
      return;
    }

    const pairing = pendingPairings.get(pairingCode);
    if (!pairing || Date.now() - pairing.createdAt > PAIRING_EXPIRY_MS) {
      pendingPairings.delete(pairingCode);
      res.status(401).json({ success: false, error: 'Invalid or expired pairing code' });
      return;
    }

    pendingPairings.delete(pairingCode);

    const deviceId = `mobile-${Date.now()}`;
    const token = generateToken(secret, deviceId);

    options?.devicesRepo?.add(deviceId, pairing.deviceName);

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

    const payload = validateToken(secret, authHeader.slice(7));
    res.json({ success: true, data: { valid: !!payload, deviceId: payload?.deviceId } });
  });

  router.post('/api/auth/register-push', (req, res) => {
    const { deviceId, pushToken } = req.body as { deviceId?: string; pushToken?: string };
    if (!deviceId || !pushToken) {
      res.status(400).json({ success: false, error: 'Missing deviceId or pushToken' });
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
    res.json({ success: true });
  });

  return router;
}
