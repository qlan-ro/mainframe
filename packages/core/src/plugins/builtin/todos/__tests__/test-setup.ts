import { vi } from 'vitest';
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { PluginContext } from '@qlan-ro/mainframe-types';
import { createPluginDatabaseContext } from '../../../db-context.js';

export interface TestHarness {
  pluginDir: string;
  notify: ReturnType<typeof vi.fn>;
  createChat: ReturnType<typeof vi.fn>;
  ctx: PluginContext;
  app: express.Express;
}

/**
 * Builds the same hand-rolled PluginContext mock used across the todos test
 * suite, so migration/route tests don't drift from each other's wiring.
 */
export async function createTestHarness(): Promise<TestHarness> {
  const pluginDir = await mkdtemp(join(tmpdir(), 'mf-todos-plugin-'));
  const db = createPluginDatabaseContext(join(pluginDir, 'data.db'));
  const notify = vi.fn();
  const createChat = vi.fn(async () => ({ chatId: 'chat-1' }));

  const router = express.Router();
  const ctx = {
    manifest: { id: 'todos', name: 'TODO Kanban', version: '1.0.0', capabilities: [] } as never,
    logger: pino({ level: 'silent' }),
    onUnload: () => {},
    router,
    config: { get: () => undefined, set: () => {}, getAll: () => ({}) },
    services: {
      chats: { listChats: async () => [], getChatById: async () => null, createChat },
      projects: { listProjects: async () => [], getProjectById: async () => null },
    },
    db,
    attachments: {
      save: vi.fn(async () => ({ id: 'a1', filename: 'x', mimeType: 'text/plain', sizeBytes: 0 })),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    },
    events: { emit: () => {}, on: () => {}, onDaemonEvent: () => {}, onChatEvent: () => {} },
    ui: {
      addPanel: () => 'panel-1',
      removePanel: () => {},
      addAction: () => {},
      removeAction: () => {},
      notify,
    },
  } as unknown as PluginContext;

  const app = express();
  app.use(express.json());
  app.use('/api/plugins/todos', router);

  return { pluginDir, notify, createChat, ctx, app };
}
