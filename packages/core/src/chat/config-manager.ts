import type { Chat, DaemonEvent } from '@mainframe/types';
import { GENERAL_DEFAULTS } from '@mainframe/types';
import type { AdapterRegistry } from '../adapters/index.js';
import type { DatabaseManager } from '../db/index.js';
import { createWorktree, removeWorktree } from '../workspace/index.js';
import type { ActiveChat } from './types.js';

export interface ConfigManagerDeps {
  adapters: AdapterRegistry;
  db: DatabaseManager;
  startingChats: Map<string, Promise<void>>;
  getActiveChat: (chatId: string) => ActiveChat | undefined;
  startChat: (chatId: string) => Promise<void>;
  emitEvent: (event: DaemonEvent) => void;
}

export class ChatConfigManager {
  constructor(private deps: ConfigManagerDeps) {}

  async updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: Chat['permissionMode'],
  ): Promise<void> {
    const active = this.deps.getActiveChat(chatId);
    if (!active) throw new Error(`Chat ${chatId} not found`);

    if (adapterId !== undefined && adapterId !== active.chat.adapterId && active.chat.claudeSessionId) {
      throw new Error('Cannot change adapter after a session has started');
    }

    const adapterChanged = adapterId !== undefined && adapterId !== active.chat.adapterId;
    const modelChanged = model !== undefined && model !== active.chat.model;
    const modeChanged = permissionMode !== undefined && permissionMode !== active.chat.permissionMode;
    if (!adapterChanged && !modelChanged && !modeChanged) return;

    if (active.session?.isSpawned && !adapterChanged) {
      if (modelChanged) await active.session.setModel(model!);
      if (modeChanged) await active.session.setPermissionMode(permissionMode!);
      const updates: Partial<Chat> = {};
      if (modelChanged) {
        updates.model = model;
        active.chat.model = model;
      }
      if (modeChanged) {
        updates.permissionMode = permissionMode;
        active.chat.permissionMode = permissionMode;
      }
      this.deps.db.chats.update(chatId, updates);
      this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
      return;
    }

    const inflight = this.deps.startingChats.get(chatId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        /* spawn may have failed */
      }
    }

    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }

    const updates: Partial<Chat> = {};
    if (adapterChanged) {
      updates.adapterId = adapterId;
      active.chat.adapterId = adapterId!;
    }
    if (modelChanged) {
      updates.model = model;
      active.chat.model = model;
    }
    if (modeChanged) {
      updates.permissionMode = permissionMode;
      active.chat.permissionMode = permissionMode;
    }

    this.deps.db.chats.update(chatId, updates);
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
    await this.deps.startChat(chatId);
  }

  async enableWorktree(chatId: string): Promise<void> {
    const active = this.deps.getActiveChat(chatId);
    if (!active) throw new Error(`Chat ${chatId} not found`);
    if (active.chat.claudeSessionId) throw new Error('Cannot enable worktree after session has started');
    if (active.chat.worktreePath) return;

    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }

    const project = this.deps.db.projects.get(active.chat.projectId);
    if (!project) throw new Error('Project not found');

    const worktreeDir = this.deps.db.settings.get('general', 'worktreeDir') ?? GENERAL_DEFAULTS.worktreeDir;
    const info = createWorktree(project.path, chatId, worktreeDir);
    active.chat.worktreePath = info.worktreePath;
    active.chat.branchName = info.branchName;
    this.deps.db.chats.update(chatId, { worktreePath: info.worktreePath, branchName: info.branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }

  async disableWorktree(chatId: string): Promise<void> {
    const active = this.deps.getActiveChat(chatId);
    if (!active?.chat.worktreePath) return;
    if (active.chat.claudeSessionId) throw new Error('Cannot disable worktree after session has started');

    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }

    const project = this.deps.db.projects.get(active.chat.projectId);
    if (project) removeWorktree(project.path, active.chat.worktreePath, active.chat.branchName!);

    active.chat.worktreePath = undefined;
    active.chat.branchName = undefined;
    this.deps.db.chats.update(chatId, { worktreePath: undefined, branchName: undefined });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }
}
