import type { Request } from 'express';
import type { DatabaseManager } from '../../db/index.js';
import type { ChatManager } from '../../chat/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import type { AttachmentStore } from '../../attachment/index.js';
import type { LaunchRegistry } from '../../launch/index.js';
import type { TunnelManager } from '../../tunnel/tunnel-manager.js';

export interface RouteContext {
  db: DatabaseManager;
  chats: ChatManager;
  adapters: AdapterRegistry;
  attachmentStore?: AttachmentStore;
  launchRegistry?: LaunchRegistry;
  tunnelUrl?: string | null;
  tunnelManager?: TunnelManager;
  setTunnelUrl?: (url: string | null) => void;
  port?: number;
}

/** Extract a route param as a string (Express 5 params may be string | string[]). */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (!v) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

/** Like getEffectivePath but always returns the project root, ignoring worktrees. */
export function getProjectPath(ctx: RouteContext, projectId: string): string | null {
  const project = ctx.db.projects.get(projectId);
  return project?.path ?? null;
}

export function getEffectivePath(ctx: RouteContext, projectId: string, chatId?: string): string | null {
  const project = ctx.db.projects.get(projectId);
  if (!project) return null;
  if (chatId) {
    const chat = ctx.chats.getChat(chatId);
    if (chat?.worktreePath) {
      if (chat.worktreeMissing) return null;
      return chat.worktreePath;
    }
  }
  return project.path;
}
