import type { Request } from 'express';
import type { DatabaseManager } from '../../db/index.js';
import type { ChatManager } from '../../chat/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import type { AttachmentStore } from '../../attachment/index.js';
import type { LaunchRegistry } from '../../launch/index.js';
import type { TunnelManager } from '../../tunnel/tunnel-manager.js';
import type { BackgroundTaskTracker } from '../../background-tasks/tracker.js';
import type { WorkflowService } from '../../workflows/index.js';
import type { AutomationService } from '../../automations/service.js';

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
  backgroundTasks?: BackgroundTaskTracker;
  workflows?: WorkflowService;
  automations?: AutomationService;
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

/**
 * Resolves the effective working-directory base for a project-scoped request.
 *
 * Path flavour: **effective-base-relative**.  When a `chatId` is supplied the
 * base is the chat's worktree directory (if one exists and is live) or the
 * project root.  All other route helpers (`resolveAndValidatePath`,
 * `resolveReadablePath`) then resolve caller-supplied paths relative to this
 * base.
 *
 * Returns `null` when:
 * - the project is not found,
 * - `chatId` is supplied but the chat does not belong to `projectId` (cross-
 *   project access guard), or
 * - the chat's worktree has been deleted (`worktreeMissing === true`).
 *
 * Routes that receive `null` should respond 404 "Project not found" for the
 * first two cases; the worktree-missing case can be distinguished by checking
 * `ctx.chats.getChat(chatId)?.worktreeMissing` and returning a 409 instead.
 */
export function getEffectivePath(ctx: RouteContext, projectId: string, chatId?: string): string | null {
  const project = ctx.db.projects.get(projectId);
  if (!project) return null;
  if (chatId) {
    const chat = ctx.chats.getChat(chatId);
    if (chat) {
      // Guard: reject cross-project access — a chatId from project B must not
      // silently re-base reads/writes under project A's URL.
      if (chat.projectId !== projectId) return null;
      if (chat.worktreePath) {
        if (chat.worktreeMissing) return null;
        return chat.worktreePath;
      }
    }
  }
  return project.path;
}
