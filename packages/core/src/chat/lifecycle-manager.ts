import type { Chat, DaemonEvent } from '@mainframe/types';
import type { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import type { DatabaseManager } from '../db/index.js';
import { removeWorktree } from '../workspace/index.js';
import { createChildLogger } from '../logger.js';
import { deriveTitleFromMessage, generateTitle } from './title-generator.js';
import { extractMentionsFromText } from './context-tracker.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';

const log = createChildLogger('chat-lifecycle');

export interface LifecycleManagerDeps {
  db: DatabaseManager;
  adapters: AdapterRegistry;
  attachmentStore?: AttachmentStore;
  activeChats: Map<string, ActiveChat>;
  processToChat: Map<string, string>;
  messages: MessageCache;
  permissions: PermissionManager;
  emitEvent: (event: DaemonEvent) => void;
}

export class ChatLifecycleManager {
  private loadingChats = new Map<string, Promise<void>>();
  private startingChats = new Map<string, Promise<void>>();

  constructor(private deps: LifecycleManagerDeps) {} // TODO rename deps to chatLifeCycleManager

  /** Expose startingChats for ConfigManager's inflight check */
  getStartingChats(): Map<string, Promise<void>> {
    return this.startingChats;
  }

  /** Expose loadingChats for getMessages' inflight check */
  getLoadingChats(): Map<string, Promise<void>> {
    return this.loadingChats;
  }

  async createChat(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
    planExecutionMode?: string,
  ): Promise<Chat> {
    const chat = this.deps.db.chats.create(projectId, adapterId, model, permissionMode);
    log.info({ chatId: chat.id, projectId, adapterId }, 'chat created');
    this.deps.activeChats.set(chat.id, { chat, process: null });
    if (planExecutionMode && permissionMode === 'plan') {
      this.deps.permissions.setPlanExecutionMode(chat.id, planExecutionMode as Chat['permissionMode']);
    }
    this.deps.emitEvent({ type: 'chat.created', chat });
    return chat;
  }

  async createChatWithDefaults(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
  ): Promise<Chat> {
    let effectiveModel = model;
    let effectiveMode = permissionMode;
    let planExecutionMode: string | undefined;

    if (!effectiveModel || !effectiveMode) {
      const defaultModel = this.deps.db.settings.get('provider', `${adapterId}.defaultModel`);
      const defaultMode = this.deps.db.settings.get('provider', `${adapterId}.defaultMode`);

      if (!effectiveModel && defaultModel) effectiveModel = defaultModel;
      if (!effectiveMode) {
        if (defaultMode === 'plan') {
          effectiveMode = 'plan';
          const storedExec = this.deps.db.settings.get('provider', `${adapterId}.planExecutionMode`);
          if (storedExec) planExecutionMode = storedExec;
        } else if (defaultMode) {
          effectiveMode = defaultMode;
        }
      }
    }

    return this.createChat(projectId, adapterId, effectiveModel, effectiveMode, planExecutionMode);
  }

  async resumeChat(chatId: string): Promise<void> {
    await this.loadChat(chatId);

    const chat = this.deps.activeChats.get(chatId)?.chat ?? this.deps.db.chats.get(chatId);
    if (chat?.processState === 'working') {
      if (chat.permissionMode === 'yolo') {
        this.deps.permissions.clear(chatId);
        await this.startChat(chatId);
      } else if (!this.deps.permissions.hasPending(chatId)) {
        await this.startChat(chatId);
      }
    }
  }

  async loadChat(chatId: string): Promise<void> {
    const inflight = this.loadingChats.get(chatId);
    if (inflight) return inflight;
    if (this.deps.activeChats.has(chatId)) return;

    const promise = this.doLoadChat(chatId);
    this.loadingChats.set(chatId, promise);
    try {
      await promise;
    } finally {
      this.loadingChats.delete(chatId);
    }
  }

  async startChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (active?.process) {
      this.deps.emitEvent({ type: 'process.started', chatId, process: active.process });
      return;
    }

    const inflight = this.startingChats.get(chatId);
    if (inflight) return inflight;

    const promise = this.doStartChat(chatId);
    this.startingChats.set(chatId, promise);
    try {
      await promise;
    } finally {
      this.startingChats.delete(chatId);
    }
  }

  async interruptChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active?.process) return;

    const adapter = this.deps.adapters.get(active.chat.adapterId);
    if (!adapter) return;

    this.deps.permissions.clear(chatId);
    this.deps.permissions.markInterrupted(chatId);
    await adapter.interrupt?.(active.process);
  }

  async archiveChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (active?.process) {
      const adapter = this.deps.adapters.get(active.chat.adapterId);
      if (adapter) await adapter.kill(active.process);
      this.deps.processToChat.delete(active.process.id);
    }

    const chat = active?.chat ?? this.deps.db.chats.get(chatId);
    if (chat?.worktreePath && chat?.branchName) {
      const project = this.deps.db.projects.get(chat.projectId);
      if (project) removeWorktree(project.path, chat.worktreePath, chat.branchName);
    }

    this.deps.activeChats.delete(chatId);
    this.deps.messages.delete(chatId);
    this.deps.permissions.clear(chatId);
    await this.deps.attachmentStore?.deleteChat(chatId);
    this.deps.db.chats.update(chatId, { status: 'archived' });
    log.info({ chatId }, 'chat archived');
    this.deps.emitEvent({ type: 'chat.ended', chatId });
  }

  async endChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active) return;

    if (active.process) {
      const adapter = this.deps.adapters.get(active.chat.adapterId);
      if (adapter) await adapter.kill(active.process);
      this.deps.processToChat.delete(active.process.id);
    }

    this.deps.db.chats.update(chatId, { status: 'ended' });
    this.deps.activeChats.delete(chatId);
    this.deps.emitEvent({ type: 'chat.ended', chatId });
  }

  async doGenerateTitle(chatId: string, content: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active) return;

    const disabled = this.deps.db.settings.get('general', 'titleGeneration.disabled');
    if (disabled === 'true') return;

    const adapterId = active.chat.adapterId;
    const binary = this.deps.db.settings.get('provider', `${adapterId}.titleBinary`) || 'claude';

    try {
      const title = await generateTitle(content, binary);
      if (title) {
        active.chat.title = title;
        this.deps.db.chats.update(chatId, { title });
        this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
      }
    } catch (err) {
      log.warn({ err }, 'Title generation failed');
    }
  }

  private async doLoadChat(chatId: string): Promise<void> {
    const chat = this.deps.db.chats.get(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    this.deps.activeChats.set(chatId, { chat, process: null });

    const adapter = this.deps.adapters.get(chat.adapterId);
    if (!adapter) return;

    const project = this.deps.db.projects.get(chat.projectId);
    if (!project) return;

    const effectivePath = chat.worktreePath ?? project.path;

    if (chat.claudeSessionId && adapter.loadHistory) {
      try {
        const history = await adapter.loadHistory(chat.claudeSessionId, effectivePath);
        if (history.length > 0) {
          this.deps.messages.set(chatId, history);
          this.deps.permissions.restorePendingPermission(chatId, history);
        }
      } catch {
        // Best-effort
      }

      const cached = this.deps.messages.get(chatId);
      if (cached) {
        for (const msg of cached) {
          if (msg.type !== 'user') continue;
          for (const block of msg.content) {
            if (block.type === 'text') extractMentionsFromText(chatId, block.text, this.deps.db);
          }
        }
      }

      if (adapter instanceof ClaudeAdapter) {
        // TODO This is wrong, anything outside adapters package should not know of "Claude"
        try {
          const [planPaths, skillPaths] = await Promise.all([
            adapter.extractPlanFilePaths(chat.claudeSessionId, effectivePath), // TODO also, this rereads all jsonl, we already do it for reading messages
            adapter.extractSkillFilePaths(chat.claudeSessionId, effectivePath),
          ]);
          for (const p of planPaths) this.deps.db.chats.addPlanFile(chatId, p); // TODO why do we add to the DB ? I believe this could live in-mem just like the permissions or messages
          for (const p of skillPaths) this.deps.db.chats.addSkillFile(chatId, p);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  private async doStartChat(chatId: string): Promise<void> {
    await this.loadChat(chatId);

    const active = this.deps.activeChats.get(chatId);
    if (active?.process) {
      this.deps.emitEvent({ type: 'process.started', chatId, process: active.process });
      return;
    }

    const preSpawn = this.deps.activeChats.get(chatId);
    if (!preSpawn) throw new Error(`Chat ${chatId} not found after load`);

    const { chat } = preSpawn;
    const adapter = this.deps.adapters.get(chat.adapterId);
    if (!adapter) throw new Error(`Adapter ${chat.adapterId} not found`);

    const project = this.deps.db.projects.get(chat.projectId);
    if (!project) throw new Error(`Project ${chat.projectId} not found`);

    const process = await adapter.spawn({
      projectPath: chat.worktreePath ?? project.path,
      chatId: chat.claudeSessionId,
      model: chat.model,
      permissionMode: chat.permissionMode,
    });
    log.info({ chatId }, 'chat process started');

    const postSpawn = this.deps.activeChats.get(chatId);
    if (!postSpawn) throw new Error(`Chat ${chatId} disappeared during spawn`);
    postSpawn.process = process;
    this.deps.processToChat.set(process.id, chatId);
    this.deps.emitEvent({ type: 'process.started', chatId, process });
  }
}
