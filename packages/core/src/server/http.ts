import express, { Express } from 'express';
import type { DatabaseManager } from '../db/index.js';
import type { ChatManager } from '../chat/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import type { LaunchRegistry } from '../launch/index.js';
import { createChildLogger } from '../logger.js';
import { createAuthMiddleware } from './middleware/auth.js';
import {
  projectRoutes,
  chatRoutes,
  fileRoutes,
  gitRoutes,
  contextRoutes,
  attachmentRoutes,
  skillRoutes,
  agentRoutes,
  adapterRoutes,
  settingRoutes,
  commandRoutes,
  launchRoutes,
  externalSessionRoutes,
  contentSearchRoutes,
} from './routes/index.js';
import { authRoutes } from './routes/auth.js';
import { tunnelRoutes } from './routes/tunnel.js';
import { PushService } from '../push/index.js';
import type { PluginManager } from '../plugins/manager.js';
import type { TunnelManager } from '../tunnel/tunnel-manager.js';

const log = createChildLogger('http');

export function createHttpServer(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginManager?: PluginManager,
  launchRegistry?: LaunchRegistry,
  getTunnelUrl?: () => string | null,
  tunnelManager?: TunnelManager,
  port?: number,
): { app: Express; pushService: PushService } {
  const app = express();
  app.set('trust proxy', 'loopback');
  const pushService = new PushService();

  const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && LOCALHOST_ORIGIN.test(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('X-Content-Type-Options', 'nosniff');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '30mb' }));

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? null;
  app.use(createAuthMiddleware(authSecret));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      tunnelUrl: ctx.tunnelUrl ?? getTunnelUrl?.() ?? null,
    });
  });

  const setTunnelUrl = (url: string | null) => {
    ctx.tunnelUrl = url;
  };

  const ctx = {
    db,
    chats,
    adapters,
    attachmentStore,
    launchRegistry,
    tunnelUrl: getTunnelUrl?.() ?? null,
    tunnelManager,
    setTunnelUrl,
    port,
  };

  app.use(authRoutes({ pushService, devicesRepo: db.devices }));
  app.use(tunnelRoutes(ctx));
  app.use(projectRoutes(ctx));
  app.use(chatRoutes(ctx));
  app.use(fileRoutes(ctx));
  app.use(contentSearchRoutes(ctx));
  app.use(gitRoutes(ctx));
  app.use(contextRoutes(ctx));
  app.use(attachmentRoutes(ctx));
  app.use(adapterRoutes(ctx));
  app.use(commandRoutes(ctx));
  app.use(skillRoutes(ctx));
  app.use(agentRoutes(ctx));
  app.use(settingRoutes(ctx));
  app.use(launchRoutes(ctx));
  app.use(externalSessionRoutes(ctx));

  // Plugin routes — the PluginManager owns a parent router with listing + per-plugin sub-routers
  if (pluginManager) {
    app.use('/api/plugins', pluginManager.router);
  }

  // Error middleware — must be after all routes
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error({ err }, 'Unhandled route error');
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  return { app, pushService };
}
