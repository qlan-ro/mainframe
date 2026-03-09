import { Router } from 'express';
import type { RouteContext } from './types.js';
import { getConfig, saveConfig } from '../../config.js';

export function tunnelRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/tunnel/status', async (_req, res) => {
    const url = ctx.tunnelManager?.getUrl('daemon') ?? null;
    const verified = url ? await ctx.tunnelManager!.verify('daemon') : false;
    res.json({ success: true, data: { running: url !== null, url, verified } });
  });

  router.get('/api/tunnel/config', (_req, res) => {
    const config = getConfig();
    res.json({
      success: true,
      data: {
        hasToken: !!config.tunnelToken,
        url: config.tunnelUrl ?? null,
      },
    });
  });

  router.post('/api/tunnel/start', async (req, res) => {
    if (!ctx.tunnelManager || !ctx.port) {
      res.status(400).json({ success: false, error: 'Tunnel not available' });
      return;
    }

    const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
    const namedUrl = typeof req.body?.url === 'string' ? req.body.url : undefined;

    const existing = ctx.tunnelManager.getUrl('daemon');
    if (existing && !token) {
      res.json({ success: true, data: { url: existing } });
      return;
    }

    try {
      const url = await ctx.tunnelManager.start(ctx.port, 'daemon', token ? { token, url: namedUrl } : undefined);
      ctx.setTunnelUrl?.(url);

      if (token && namedUrl) {
        saveConfig({ tunnel: true, tunnelToken: token, tunnelUrl: namedUrl });
      } else {
        saveConfig({ tunnel: true });
      }

      res.json({ success: true, data: { url } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start tunnel';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/api/tunnel/stop', (req, res) => {
    if (!ctx.tunnelManager) {
      res.status(400).json({ success: false, error: 'Tunnel not available' });
      return;
    }

    ctx.tunnelManager.stop('daemon');
    ctx.setTunnelUrl?.(null);

    const clearConfig = req.body?.clearConfig === true;
    if (clearConfig) {
      saveConfig({ tunnel: false, tunnelToken: undefined, tunnelUrl: undefined });
    } else {
      saveConfig({ tunnel: false });
    }

    res.json({ success: true });
  });

  return router;
}
