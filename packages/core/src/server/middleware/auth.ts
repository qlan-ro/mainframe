import type { Request, Response, NextFunction } from 'express';
import { validateToken } from '../../auth/token.js';

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalhost(req: Request): boolean {
  return LOCALHOST_IPS.has(req.ip ?? '');
}

export function createAuthMiddleware(secret: string | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // No secret configured — auth disabled
    if (!secret) return next();

    // Pairing flow routes must be accessible without auth
    const UNAUTHENTICATED_PATHS = new Set([
      '/api/auth/pair',
      '/api/auth/confirm',
      '/api/auth/status',
      '/api/auth/register-push',
    ]);
    if (UNAUTHENTICATED_PATHS.has(req.path)) return next();

    // Health check always accessible
    if (req.path === '/health') return next();

    // Localhost is exempt
    if (isLocalhost(req)) return next();

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const token = authHeader.slice(7);
    const payload = validateToken(secret, token);
    if (!payload) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    next();
  };
}
