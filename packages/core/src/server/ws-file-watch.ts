import { realpath, stat } from 'node:fs/promises';
import { WebSocket } from 'ws';
import type { ChatManager } from '../chat/index.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { FileWatcherService } from '../files/file-watcher.js';
import { resolveAndValidatePath } from './routes/path-utils.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('ws-file-watch');

/** Build a composite map key so the same relative path under different projects/chats never collides. */
export function compositeKey(requestedPath: string, projectId?: string, chatId?: string): string {
  return `${projectId ?? ''}|${chatId ?? ''}|${requestedPath}`;
}

/**
 * Resolve a client-supplied path to an absolute, containment-validated path.
 * Absolute paths pass through; relative paths require a projectId.
 *
 * When both projectId and chatId are supplied, validates that the chat belongs
 * to the claimed project — rejects on mismatch to prevent cross-project traversal.
 */
export function resolveSubscribePath(
  chats: ChatManager,
  requestedPath: string,
  projectId?: string,
  chatId?: string,
): string | null {
  if (requestedPath.startsWith('/')) {
    return requestedPath;
  }
  if (!projectId) {
    log.warn({ path: requestedPath }, 'subscribe:file rejected: relative path requires projectId');
    return null;
  }
  if (chatId) {
    const chatProjectId = chats.getChatProjectId(chatId);
    if (chatProjectId !== null && chatProjectId !== projectId) {
      log.warn(
        { path: requestedPath, projectId, chatId, chatProjectId },
        'subscribe:file rejected: chat does not belong to claimed projectId',
      );
      return null;
    }
  }
  const basePath = chatId ? chats.getEffectivePath(chatId) : chats.getProjectPath(projectId);
  if (!basePath) {
    log.warn({ path: requestedPath, projectId, chatId }, 'subscribe:file rejected: project/worktree not found');
    return null;
  }
  const validated = resolveAndValidatePath(basePath, requestedPath);
  if (!validated) {
    log.warn({ path: requestedPath, basePath }, 'subscribe:file rejected: path escapes project base');
    return null;
  }
  return validated;
}

/**
 * Per-client file-watch state.
 * Tracks which absolute paths this client is subscribed to and maps a
 * composite key (projectId|chatId|requestedPath) → resolvedPath so
 * the same relative filename under two different projects never collides.
 */
export class WsFileWatch {
  readonly fileSubscriptions = new Set<string>();
  /** composite(projectId|chatId|requestedPath) → resolvedPath */
  readonly requestedToResolved = new Map<string, string>();

  async subscribe(
    requestedPath: string,
    absolutePath: string,
    fileWatcher: FileWatcherService,
    ws: WebSocket,
    projectId?: string,
    chatId?: string,
  ): Promise<void> {
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(absolutePath);
    } catch {
      log.warn({ path: absolutePath }, 'subscribe:file rejected: realpath failed (file may not exist)');
      return;
    }
    try {
      const s = await stat(resolvedPath);
      if (!s.isFile()) {
        log.warn({ path: resolvedPath }, 'subscribe:file rejected: not a regular file');
        return;
      }
    } catch (err) {
      log.warn({ err, path: resolvedPath }, 'subscribe:file rejected: stat failed');
      return;
    }

    if (!this.fileSubscriptions.has(resolvedPath)) {
      this.fileSubscriptions.add(resolvedPath);
      fileWatcher.subscribe(resolvedPath);
      log.debug({ path: resolvedPath }, 'client subscribed to file');
    }
    this.requestedToResolved.set(compositeKey(requestedPath, projectId, chatId), resolvedPath);

    if (ws.readyState === WebSocket.OPEN) {
      const ack: DaemonEvent = { type: 'subscribe:file:ack', requestedPath, resolvedPath };
      ws.send(JSON.stringify(ack));
    }
  }

  unsubscribe(requestedPath: string, fileWatcher: FileWatcherService, projectId?: string, chatId?: string): void {
    const key = compositeKey(requestedPath, projectId, chatId);
    const resolvedPath = this.requestedToResolved.get(key);
    if (!resolvedPath) return;
    this.requestedToResolved.delete(key);
    this.fileSubscriptions.delete(resolvedPath);
    fileWatcher.unsubscribe(resolvedPath);
    log.debug({ path: resolvedPath }, 'client unsubscribed from file');
  }

  unsubscribeAll(fileWatcher: FileWatcherService): void {
    for (const filePath of this.fileSubscriptions) {
      fileWatcher.unsubscribe(filePath);
    }
    this.requestedToResolved.clear();
    this.fileSubscriptions.clear();
  }
}
