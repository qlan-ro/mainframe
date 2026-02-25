import type { Request } from 'express';
import type { DatabaseManager } from '../../db/index.js';
import type { ChatManager } from '../../chat/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import type { AttachmentStore } from '../../attachment/index.js';

export interface LaunchRegistryLike {
  getOrCreate(
    projectId: string,
    projectPath: string,
  ): {
    start(config: import('@mainframe/types').LaunchConfiguration): Promise<void>;
    stop(name: string): void;
    getAllStatuses(): Record<string, import('@mainframe/types').LaunchProcessStatus>;
  };
}

export interface RouteContext {
  db: DatabaseManager;
  chats: ChatManager;
  adapters: AdapterRegistry;
  attachmentStore?: AttachmentStore;
  launchRegistry?: LaunchRegistryLike;
}

/** Extract a route param as a string (Express 5 params may be string | string[]). */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (!v) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

export function getEffectivePath(ctx: RouteContext, projectId: string, chatId?: string): string | null {
  const project = ctx.db.projects.get(projectId);
  if (!project) return null;
  if (chatId) {
    const chat = ctx.chats.getChat(chatId);
    if (chat?.worktreePath) return chat.worktreePath;
  }
  return project.path;
}
