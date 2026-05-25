import type { Request, Response, NextFunction } from 'express';
import { validateAuthedToken } from '../../auth/validate-authed-token.js';
import type { DevicesRepository } from '../../db/devices.js';

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const UNAUTHENTICATED_PATHS = new Set(['/api/auth/confirm', '/api/auth/status', '/api/auth/pair-status']);

function isLocalhost(req: Request): boolean {
  return LOCALHOST_IPS.has(req.ip ?? '');
}

function tryAttachAuth(req: Request, secret: string, devicesRepo: DevicesRepository | undefined): void {
  if (!devicesRepo) return;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;
  const payload = validateAuthedToken(secret, authHeader.slice(7), devicesRepo);
  if (payload) req.auth = payload;
}

export function createAuthMiddleware(secret: string | null, devicesRepo?: DevicesRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!secret) return next();

    if (UNAUTHENTICATED_PATHS.has(req.path)) return next();
    if (req.path === '/health') return next();

    if (isLocalhost(req)) {
      tryAttachAuth(req, secret, devicesRepo);
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!devicesRepo) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const payload = validateAuthedToken(secret, authHeader.slice(7), devicesRepo);
    if (!payload) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    req.auth = payload;
    next();
  };
}
