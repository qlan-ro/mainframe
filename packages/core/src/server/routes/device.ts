import { Router } from 'express';
import { z } from 'zod';
import type { PushService } from '../../push/push-service.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('device-route');

const ActivityBodySchema = z.object({
  state: z.enum(['active', 'idle']),
});

export interface DeviceRouteOptions {
  pushService?: PushService;
}

export function deviceRoutes(options?: DeviceRouteOptions): Router {
  const router = Router();

  router.post('/api/device/activity', (req, res) => {
    const parsed = ActivityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid body: state must be "active" or "idle"' });
      return;
    }

    const { state } = parsed.data;
    options?.pushService?.setDesktopActive(state === 'active');
    log.info({ state }, 'desktop activity state updated');

    res.json({ success: true });
  });

  return router;
}
