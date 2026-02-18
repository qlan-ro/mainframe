import { EventEmitter } from 'node:events';
import type {
  Chat,
  ChatMessage,
  PermissionRequest,
  PermissionResponse,
  DaemonEvent,
  SessionMention,
  SessionContext,
} from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import { MessageCache } from './message-cache.js';
import { PermissionManager } from './permission-manager.js';
import { deriveTitleFromMessage } from './title-generator.js';
import { extractMentionsFromText, getSessionContext } from './context-tracker.js';
import { processAttachments, type AttachmentResult } from './attachment-processor.js';
import { PlanModeHandler } from './plan-mode-handler.js';
import { ChatPermissionHandler } from './permission-handler.js';
import { ChatConfigManager } from './config-manager.js';
import { ChatLifecycleManager } from './lifecycle-manager.js';
import { EventHandler, type ChatLookup } from './event-handler.js';
import type { ActiveChat } from './types.js';

export class ChatManager extends EventEmitter implements ChatLookup {
  private activeChats = new Map<string, ActiveChat>();
  private processToChat = new Map<string, string>();
  private messages = new MessageCache();
  private permissions: PermissionManager;
  private planMode: PlanModeHandler;
  private permissionHandler: ChatPermissionHandler;
  private configManager: ChatConfigManager;
  private lifecycle: ChatLifecycleManager;

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private attachmentStore?: AttachmentStore,
  ) {
    super();
    this.permissions = new PermissionManager(db, adapters);
    this.planMode = new PlanModeHandler({
      permissions: this.permissions,
      messages: this.messages,
      db: this.db,
      adapters: this.adapters,
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      emitEvent: (event) => this.emitEvent(event),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      sendMessage: (chatId, content) => this.sendMessage(chatId, content),
    });
    this.lifecycle = new ChatLifecycleManager({
      db: this.db,
      adapters: this.adapters,
      attachmentStore: this.attachmentStore,
      activeChats: this.activeChats,
      processToChat: this.processToChat,
      messages: this.messages,
      permissions: this.permissions,
      emitEvent: (event) => this.emitEvent(event),
    });
    this.permissionHandler = new ChatPermissionHandler({
      permissions: this.permissions,
      planMode: this.planMode,
      messages: this.messages,
      adapters: this.adapters,
      db: this.db,
      processToChat: this.processToChat,
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      emitEvent: (event) => this.emitEvent(event),
      getChat: (chatId) => this.getChat(chatId),
      getMessages: (chatId) => this.getMessages(chatId),
    });
    this.configManager = new ChatConfigManager({
      adapters: this.adapters,
      db: this.db,
      processToChat: this.processToChat,
      startingChats: this.lifecycle.getStartingChats(),
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      emitEvent: (event) => this.emitEvent(event),
    });
    new EventHandler(this, this.db, this.adapters, this.messages, this.permissions, (e) => this.emitEvent(e)).setup();
  }

  getActiveChat(chatId: string): ActiveChat | undefined {
    return this.activeChats.get(chatId);
  }

  getChatIdForProcess(processId: string): string | undefined {
    return this.processToChat.get(processId);
  }

  deleteProcessMapping(processId: string): void {
    this.processToChat.delete(processId);
  }

  async createChat(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
    planExecutionMode?: string,
  ): Promise<Chat> {
    return this.lifecycle.createChat(projectId, adapterId, model, permissionMode, planExecutionMode);
  }

  async createChatWithDefaults(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
  ): Promise<Chat> {
    return this.lifecycle.createChatWithDefaults(projectId, adapterId, model, permissionMode);
  }

  async resumeChat(chatId: string): Promise<void> {
    return this.lifecycle.resumeChat(chatId);
  }

  async updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: Chat['permissionMode'],
  ): Promise<void> {
    return this.configManager.updateChatConfig(chatId, adapterId, model, permissionMode);
  }

  async enableWorktree(chatId: string): Promise<void> {
    return this.configManager.enableWorktree(chatId);
  }

  async disableWorktree(chatId: string): Promise<void> {
    return this.configManager.disableWorktree(chatId);
  }

  async loadChat(chatId: string): Promise<void> {
    return this.lifecycle.loadChat(chatId);
  }

  async startChat(chatId: string): Promise<void> {
    return this.lifecycle.startChat(chatId);
  }

  async interruptChat(chatId: string): Promise<void> {
    return this.lifecycle.interruptChat(chatId);
  }

  async sendMessage(chatId: string, content: string, attachmentIds?: string[]): Promise<void> {
    if (!this.activeChats.get(chatId)?.process) {
      await this.lifecycle.startChat(chatId);
    }

    const active = this.activeChats.get(chatId);
    if (!active?.process) throw new Error(`Chat ${chatId} not running`);

    const adapter = this.adapters.get(active.chat.adapterId);
    if (!adapter) throw new Error(`Adapter not found`);

    const empty: AttachmentResult = { images: [], messageContent: [], textPrefix: [], attachmentPreviews: [] };
    const { images, messageContent, textPrefix, attachmentPreviews } =
      attachmentIds?.length && this.attachmentStore
        ? await processAttachments(chatId, attachmentIds, this.attachmentStore)
        : empty;
    if (content) {
      messageContent.push({ type: 'text', text: content });
    }
    const outgoingContent =
      textPrefix.length > 0 ? (content ? `${textPrefix.join('\n')}\n\n${content}` : textPrefix.join('\n')) : content;

    const isQueued = active.chat.processState === 'working';
    const transientMetadata: Record<string, unknown> = {};
    if (isQueued) transientMetadata.queued = true;
    if (attachmentPreviews.length > 0) transientMetadata.attachments = attachmentPreviews;
    const message = this.messages.createTransientMessage(
      chatId,
      'user',
      messageContent,
      Object.keys(transientMetadata).length > 0 ? transientMetadata : undefined,
    );
    this.messages.append(chatId, message);
    this.emitEvent({ type: 'message.added', chatId, message });
    if (attachmentIds && attachmentIds.length > 0) {
      this.emitEvent({ type: 'context.updated', chatId });
    }

    if (extractMentionsFromText(chatId, content, this.db)) {
      this.emitEvent({ type: 'context.updated', chatId });
    }

    if (!active.chat.title) {
      const title = deriveTitleFromMessage(content);
      active.chat.title = title;
      this.db.chats.update(chatId, { title });
      this.emitEvent({ type: 'chat.updated', chat: active.chat });

      this.lifecycle.doGenerateTitle(chatId, content).catch(() => {});
    }

    active.chat.processState = 'working';
    this.db.chats.update(chatId, { processState: 'working' });
    this.emitEvent({ type: 'chat.updated', chat: active.chat });

    await adapter.sendMessage(active.process, outgoingContent, images.length > 0 ? images : undefined);
  }

  async respondToPermission(chatId: string, response: PermissionResponse): Promise<void> {
    return this.permissionHandler.respondToPermission(chatId, response);
  }

  async archiveChat(chatId: string): Promise<void> {
    return this.lifecycle.archiveChat(chatId);
  }

  async endChat(chatId: string): Promise<void> {
    return this.lifecycle.endChat(chatId);
  }

  getChat(chatId: string): Chat | null {
    const active = this.activeChats.get(chatId);
    if (active) return active.chat;
    return this.db.chats.get(chatId);
  }

  getEffectivePath(chatId: string): string | null {
    const chat = this.getChat(chatId);
    if (!chat) return null;
    if (chat.worktreePath) return chat.worktreePath;
    const project = this.db.projects.get(chat.projectId);
    return project?.path ?? null;
  }

  async getMessages(chatId: string): Promise<ChatMessage[]> {
    const inflight = this.lifecycle.getLoadingChats().get(chatId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        /* handled by loadChat */
      }
    }

    const cached = this.messages.get(chatId);
    if (cached && cached.length > 0) return cached;

    const chat = this.getChat(chatId);
    if (!chat?.claudeSessionId) return [];

    const adapter = this.adapters.get(chat.adapterId);
    if (!adapter?.loadHistory) return [];

    const project = this.db.projects.get(chat.projectId);
    if (!project) return [];

    try {
      const history = await adapter.loadHistory(chat.claudeSessionId, chat.worktreePath ?? project.path);
      if (history.length > 0) {
        this.messages.set(chatId, history);
        this.permissions.restorePendingPermission(chatId, history);
      }
      return history;
    } catch {
      /* best-effort: return empty if history loading fails */
      return [];
    }
  }

  isChatRunning(chatId: string): boolean {
    const active = this.activeChats.get(chatId);
    return active?.process != null;
  }

  addMention(chatId: string, mention: SessionMention): void {
    this.db.chats.addMention(chatId, mention);
    this.emitEvent({ type: 'context.updated', chatId });
  }

  async getSessionContext(chatId: string, projectPath: string): Promise<SessionContext> {
    const chat = this.getChat(chatId);
    return getSessionContext(chatId, projectPath, this.db, this.adapters, this.attachmentStore, chat?.adapterId);
  }

  async getPendingPermission(chatId: string): Promise<PermissionRequest | null> {
    return this.permissionHandler.getPendingPermission(chatId);
  }

  hasPendingPermission(chatId: string): boolean {
    return this.permissionHandler.hasPendingPermission(chatId);
  }

  clearPendingPermission(chatId: string): void {
    this.permissionHandler.clearPendingPermission(chatId);
  }

  private emitEvent(event: DaemonEvent): void {
    if (event.type === 'chat.updated' || event.type === 'chat.created') {
      const chat = event.chat;
      const hasPending = this.permissions.hasPending(chat.id);
      chat.displayStatus = hasPending ? 'waiting' : chat.processState === 'working' ? 'working' : 'idle';
      chat.isRunning = chat.processState === 'working' && !hasPending;
    }
    this.emit('event', event);
  }
}
