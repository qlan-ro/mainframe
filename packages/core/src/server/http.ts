import express, { Express } from 'express';
import type { DatabaseManager } from '../db/index.js';
import type { ChatManager } from '../chat/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import type { LaunchRegistry } from '../launch/index.js';
import { createChildLogger } from '../logger.js';
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
} from './routes/index.js';
import type { PluginManager } from '../plugins/manager.js';

const log = createChildLogger('http');

export function createHttpServer(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginManager?: PluginManager,
  launchRegistry?: LaunchRegistry,
): Express {
  const app = express();

  const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:31415',
    'http://127.0.0.1:31415',
  ]);

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const ctx = { db, chats, adapters, attachmentStore, launchRegistry };

  app.use(projectRoutes(ctx));
  app.use(chatRoutes(ctx));
  app.use(fileRoutes(ctx));
  app.use(gitRoutes(ctx));
  app.use(contextRoutes(ctx));
  app.use(attachmentRoutes(ctx));
  app.use(adapterRoutes(ctx));
  app.use(commandRoutes(ctx));
  app.use(skillRoutes(ctx));
  app.use(agentRoutes(ctx));
  app.use(settingRoutes(ctx));
  app.use(launchRoutes(ctx));

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

  return app;
}
