import type {
  Chat,
  ChatMessage,
  ControlRequest,
  ControlResponse,
  DaemonEvent,
  SessionMention,
  SessionContext,
} from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import { createChildLogger } from '../logger.js';
import { MessageCache } from './message-cache.js';
import { PermissionManager } from './permission-manager.js';
import { deriveTitleFromMessage } from './title-generator.js';
import { extractMentionsFromText, getSessionContext } from './context-tracker.js';
import { processAttachments, type AttachmentResult } from './attachment-processor.js';
import { PlanModeHandler } from './plan-mode-handler.js';
import { ChatPermissionHandler } from './permission-handler.js';
import { ChatConfigManager } from './config-manager.js';
import { ChatLifecycleManager } from './lifecycle-manager.js';
import { EventHandler } from './event-handler.js';
import type { ActiveChat } from './types.js';
import { wrapMainframeCommand } from '../commands/wrap.js';

const logger = createChildLogger('chat:manager');

export class ChatManager {
  private activeChats = new Map<string, ActiveChat>();
  private messages = new MessageCache();
  private permissions: PermissionManager;
  private planMode: PlanModeHandler;
  private permissionHandler: ChatPermissionHandler;
  private configManager: ChatConfigManager;
  private lifecycle: ChatLifecycleManager;
  private eventHandler: EventHandler;

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private attachmentStore?: AttachmentStore,
    private onEvent: (event: DaemonEvent) => void = () => {},
  ) {
    this.permissions = new PermissionManager(db, adapters);
    this.eventHandler = new EventHandler(
      this.db,
      this.messages,
      this.permissions,
      (chatId) => this.activeChats.get(chatId),
      (e) => this.emitEvent(e),
    );
    this.planMode = new PlanModeHandler({
      permissions: this.permissions,
      messages: this.messages,
      db: this.db,
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
      messages: this.messages,
      permissions: this.permissions,
      emitEvent: (event) => this.emitEvent(event),
      buildSink: (chatId, respondToPermission) => this.eventHandler.buildSink(chatId, respondToPermission),
    });
    this.permissionHandler = new ChatPermissionHandler({
      permissions: this.permissions,
      planMode: this.planMode,
      messages: this.messages,
      db: this.db,
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      emitEvent: (event) => this.emitEvent(event),
      getChat: (chatId) => this.getChat(chatId),
      getMessages: (chatId) => this.getMessages(chatId),
    });
    this.configManager = new ChatConfigManager({
      adapters: this.adapters,
      db: this.db,
      startingChats: this.lifecycle.getStartingChats(),
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      emitEvent: (event) => this.emitEvent(event),
    });
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

  async sendMessage(
    chatId: string,
    content: string,
    attachmentIds?: string[],
    metadata?: { command?: { name: string; source: string; args?: string } },
  ): Promise<void> {
    const active = this.activeChats.get(chatId);
    if (!active?.session?.isSpawned) {
      await this.lifecycle.startChat(chatId);
    }

    const postStart = this.activeChats.get(chatId);
    if (!postStart?.session?.isSpawned) throw new Error(`Chat ${chatId} not running`);
    logger.info({ chatId }, 'user message sent');

    // Command routing — provider commands go to sendCommand, mainframe commands get wrapped
    if (metadata?.command) {
      const { name, source, args } = metadata.command;
      if (source === 'mainframe') {
        const wrappedContent = wrapMainframeCommand(name, content, args);
        await postStart.session.sendMessage(wrappedContent);
      } else {
        await postStart.session.sendCommand(name, args);
      }
      // Update process state for commands too
      postStart.chat.processState = 'working';
      this.db.chats.update(chatId, { processState: 'working' });
      this.emitEvent({ type: 'chat.updated', chat: postStart.chat });
      return;
    }

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

    const isQueued = postStart.chat.processState === 'working';
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

    if (!postStart.chat.title) {
      const title = deriveTitleFromMessage(content);
      postStart.chat.title = title;
      this.db.chats.update(chatId, { title });
      this.emitEvent({ type: 'chat.updated', chat: postStart.chat });

      this.lifecycle.doGenerateTitle(chatId, content).catch(() => {});
    }

    postStart.chat.processState = 'working';
    this.db.chats.update(chatId, { processState: 'working' });
    this.emitEvent({ type: 'chat.updated', chat: postStart.chat });

    await postStart.session.sendMessage(outgoingContent, images.length > 0 ? images : undefined);
  }

  async respondToPermission(chatId: string, response: ControlResponse): Promise<void> {
    logger.info({ chatId, behavior: response.behavior, toolName: response.toolName }, 'permission answered');
    return this.permissionHandler.respondToPermission(chatId, response);
  }

  async archiveChat(chatId: string): Promise<void> {
    return this.lifecycle.archiveChat(chatId);
  }

  async endChat(chatId: string): Promise<void> {
    return this.lifecycle.endChat(chatId);
  }

  async removeProject(projectId: string): Promise<void> {
    logger.info({ projectId }, 'project removed');
    const chats = this.db.chats.list(projectId);
    for (const chat of chats) {
      const active = this.activeChats.get(chat.id);
      if (active?.session) {
        try {
          await active.session.kill();
        } catch (err) {
          logger.warn({ err, chatId: chat.id }, 'failed to kill session on project removal');
        }
      }
      this.activeChats.delete(chat.id);
      this.messages.delete(chat.id);
      this.permissions.clear(chat.id);
    }
    this.db.projects.removeWithChats(projectId);
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
    if (!adapter) return [];

    const project = this.db.projects.get(chat.projectId);
    if (!project) return [];

    try {
      const session = adapter.createSession({
        projectPath: chat.worktreePath ?? project.path,
        chatId: chat.claudeSessionId,
      });
      const history = await session.loadHistory();
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
    return active?.session?.isSpawned === true;
  }

  addMention(chatId: string, mention: SessionMention): void {
    this.db.chats.addMention(chatId, mention);
    this.emitEvent({ type: 'context.updated', chatId });
  }

  async getSessionContext(chatId: string, projectPath: string): Promise<SessionContext> {
    const chat = this.getChat(chatId);
    const active = this.activeChats.get(chatId);
    const session = active?.session ?? undefined;
    return getSessionContext(
      chatId,
      projectPath,
      this.db,
      this.adapters,
      session,
      this.attachmentStore,
      chat?.adapterId,
    );
  }

  async getPendingPermission(chatId: string): Promise<ControlRequest | null> {
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
    this.onEvent(event);
  }
}
