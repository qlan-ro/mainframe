import type {
  Chat,
  ChatMessage,
  ControlRequest,
  ControlResponse,
  DaemonEvent,
  DisplayMessage,
  QueuedMessageRef,
  SessionMention,
  SessionContext,
} from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
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
import { ExternalSessionService } from './external-session-service.js';
import type { ActiveChat } from './types.js';
import { wrapMainframeCommand } from '../commands/wrap.js';
import { findMainframeCommand } from '../commands/registry.js';
import { prepareMessagesForClient } from '../messages/display-pipeline.js';

const logger = createChildLogger('chat:manager');

export class ChatManager {
  private activeChats = new Map<string, ActiveChat>();
  private queuedRefs = new Map<string, QueuedMessageRef>();
  private messages = new MessageCache();
  private permissions: PermissionManager;
  private planMode: PlanModeHandler;
  private permissionHandler: ChatPermissionHandler;
  private configManager: ChatConfigManager;
  private lifecycle: ChatLifecycleManager;
  private eventHandler: EventHandler;
  private externalSessions: ExternalSessionService;

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private attachmentStore?: AttachmentStore,
    private onEvent: (event: DaemonEvent) => void = () => {},
  ) {
    this.permissions = new PermissionManager();
    this.eventHandler = new EventHandler(
      this.db,
      this.messages,
      this.permissions,
      (chatId) => this.activeChats.get(chatId),
      (e) => this.emitEvent(e),
      (chatId) => {
        const chat = this.activeChats.get(chatId)?.chat ?? this.db.chats.get(chatId);
        const adapter = chat ? this.adapters.get(chat.adapterId) : undefined;
        return adapter?.getToolCategories?.();
      },
    );
    this.planMode = new PlanModeHandler({
      permissions: this.permissions,
      messages: this.messages,
      db: this.db,
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      emitEvent: (event) => this.emitEvent(event),
      clearDisplayCache: (chatId) => this.eventHandler.clearDisplayCache(chatId),
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
      emitDisplay: (chatId) => this.eventHandler.emitDisplay(chatId),
      getChat: (chatId) => this.getChat(chatId),
      getMessages: (chatId) => this.getMessages(chatId),
    });
    this.configManager = new ChatConfigManager({
      adapters: this.adapters,
      db: this.db,
      startingChats: this.lifecycle.getStartingChats(),
      getActiveChat: (chatId) => this.activeChats.get(chatId),
      startChat: (chatId) => this.lifecycle.startChat(chatId),
      stopChat: (chatId) => this.lifecycle.stopChat(chatId),
      emitEvent: (event) => this.emitEvent(event),
    });
    this.externalSessions = new ExternalSessionService(this.db, this.adapters, (e) => this.emitEvent(e));
  }

  /** Late-bind a callback to stop launch processes before worktree removal */
  setStopLaunchProcesses(fn: (projectId: string, projectPath: string) => Promise<void>): void {
    this.lifecycle.setStopLaunchProcesses(fn);
    this.configManager.setStopLaunchProcesses(fn);
  }

  setPushService(service: import('../push/push-service.js').PushService): void {
    this.eventHandler.setPushService(service);
  }

  getExternalSessionService(): ExternalSessionService {
    return this.externalSessions;
  }

  startExternalSessionScan(projectId: string): void {
    this.externalSessions.startAutoScan(projectId);
  }

  stopExternalSessionScan(projectId: string): void {
    this.externalSessions.stopAutoScan(projectId);
  }

  async createChat(projectId: string, adapterId: string, model?: string, permissionMode?: string): Promise<Chat> {
    return this.lifecycle.createChat(projectId, adapterId, model, permissionMode);
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

  async enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
    return this.configManager.enableWorktree(chatId, baseBranch, branchName);
  }

  async attachWorktree(chatId: string, worktreePath: string, branchName: string): Promise<void> {
    return this.configManager.attachWorktree(chatId, worktreePath, branchName);
  }

  async disableWorktree(chatId: string): Promise<void> {
    return this.configManager.disableWorktree(chatId);
  }

  async forkToWorktree(chatId: string, baseBranch: string, branchName: string): Promise<{ chatId: string }> {
    return this.lifecycle.forkToWorktree(chatId, baseBranch, branchName, (newChatId, base, branch) =>
      this.configManager.enableWorktree(newChatId, base, branch),
    );
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
    const chat = this.getChat(chatId);
    if (chat?.worktreeMissing) {
      const errorMsg = this.messages.createTransientMessage(chatId, 'error', [
        {
          type: 'error',
          message: `Worktree directory no longer exists: ${chat.worktreePath}. Archive this session or recreate the worktree.`,
        },
      ]);
      this.messages.append(chatId, errorMsg);
      this.emitEvent({ type: 'message.added', chatId, message: errorMsg });
      this.eventHandler.emitDisplay(chatId);
      return;
    }

    // Wait for any in-flight interrupt to finish before checking spawn state.
    // SIGINT kills the CLI process; without this wait a fast follow-up message
    // could write to the dying process's stdin and be silently lost.
    await this.lifecycle.waitForInterrupt(chatId);

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

      // Store the user's command as a visible message so it renders in the thread
      const userMessage = this.messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: content }]);
      this.messages.append(chatId, userMessage);
      this.emitEvent({ type: 'message.added', chatId, message: userMessage });
      this.eventHandler.emitDisplay(chatId);

      if (source === 'mainframe') {
        const resolvedArgs = args ?? findMainframeCommand(name)?.promptTemplate ?? '';
        const wrappedContent = wrapMainframeCommand(name, content, resolvedArgs);
        await postStart.session.sendMessage(wrappedContent);
      } else {
        await postStart.session.sendCommand(name, args);
      }
      const now = new Date().toISOString();
      postStart.chat.processState = 'working';
      postStart.chat.updatedAt = now;
      this.db.chats.update(chatId, { processState: 'working', updatedAt: now });
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

    // Generate uuid for queued messages — used for cancel tracking
    const messageUuid = isQueued ? nanoid() : undefined;
    if (messageUuid) transientMetadata.uuid = messageUuid;
    const message = this.messages.createTransientMessage(
      chatId,
      'user',
      messageContent,
      Object.keys(transientMetadata).length > 0 ? transientMetadata : undefined,
    );
    this.messages.append(chatId, message);
    this.emitEvent({ type: 'message.added', chatId, message });
    this.eventHandler.emitDisplay(chatId);
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

    const now = new Date().toISOString();
    postStart.chat.processState = 'working';
    postStart.chat.updatedAt = now;
    this.db.chats.update(chatId, { processState: 'working', updatedAt: now });
    this.emitEvent({ type: 'chat.updated', chat: postStart.chat });

    await postStart.session.sendMessage(outgoingContent, images.length > 0 ? images : undefined, messageUuid);

    // Track queued message ref for cancel/edit
    if (messageUuid) {
      const ref: QueuedMessageRef = {
        messageId: message.id,
        chatId,
        uuid: messageUuid,
        content,
        attachmentIds: attachmentIds?.length ? attachmentIds : undefined,
        timestamp: message.timestamp,
      };
      this.queuedRefs.set(messageUuid, ref);
      this.emitEvent({ type: 'message.queued', chatId, ref });
      logger.info({ chatId, uuid: messageUuid, messageId: message.id }, 'message sent to CLI while busy (queued)');
    }
  }

  async editQueuedMessage(chatId: string, messageId: string, content: string): Promise<void> {
    const ref = [...this.queuedRefs.values()].find((r) => r.chatId === chatId && r.messageId === messageId);
    if (!ref) return;

    const active = this.activeChats.get(chatId);
    if (!active?.session) return;

    const cancelled = await active.session.cancelQueuedMessage(ref.uuid);
    if (!cancelled) {
      logger.info({ chatId, uuid: ref.uuid }, 'edit failed: message already dequeued by CLI');
      this.emitEvent({ type: 'message.queued.cancel_failed', chatId, uuid: ref.uuid });
      return;
    }

    this.queuedRefs.delete(ref.uuid);
    this.emitEvent({ type: 'message.queued.cancelled', chatId, uuid: ref.uuid });
    this.messages.removeById(chatId, ref.messageId);
    this.eventHandler.emitDisplay(chatId);

    await this.sendMessage(chatId, content, ref.attachmentIds);
  }

  async cancelQueuedMessage(chatId: string, messageId: string): Promise<void> {
    const ref = [...this.queuedRefs.values()].find((r) => r.chatId === chatId && r.messageId === messageId);
    if (!ref) return;

    const active = this.activeChats.get(chatId);
    if (!active?.session) return;

    const cancelled = await active.session.cancelQueuedMessage(ref.uuid);
    if (!cancelled) {
      logger.info({ chatId, uuid: ref.uuid }, 'cancel failed: message already dequeued by CLI');
      this.emitEvent({ type: 'message.queued.cancel_failed', chatId, uuid: ref.uuid });
      return;
    }

    this.queuedRefs.delete(ref.uuid);
    this.messages.removeById(chatId, ref.messageId);
    this.emitEvent({ type: 'message.queued.cancelled', chatId, uuid: ref.uuid });
    this.eventHandler.emitDisplay(chatId);
    logger.info({ chatId, uuid: ref.uuid }, 'queued message cancelled in CLI');
  }

  handleQueuedProcessed(chatId: string, uuid: string): void {
    const ref = this.queuedRefs.get(uuid);
    if (!ref) return;
    this.queuedRefs.delete(uuid);
    logger.info({ chatId, uuid, messageId: ref.messageId }, 'CLI processed queued message');
  }

  async respondToPermission(chatId: string, response: ControlResponse): Promise<void> {
    logger.info({ chatId, behavior: response.behavior, toolName: response.toolName }, 'permission answered');
    return this.permissionHandler.respondToPermission(chatId, response);
  }

  renameChat(chatId: string, title: string): void {
    this.db.chats.update(chatId, { title });
    const active = this.activeChats.get(chatId);
    if (active) active.chat.title = title;
  }

  async archiveChat(chatId: string, deleteWorktree = true): Promise<void> {
    await this.lifecycle.archiveChat(chatId, deleteWorktree);
    this.eventHandler.clearDisplayCache(chatId);
  }

  async endChat(chatId: string): Promise<void> {
    await this.lifecycle.endChat(chatId);
    this.eventHandler.clearDisplayCache(chatId);
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
      this.eventHandler.clearDisplayCache(chat.id);
    }
    this.db.projects.removeWithChats(projectId);
  }

  listChats(projectId: string): Chat[] {
    const chats = this.db.chats.list(projectId);
    return chats.map((chat) => this.enrichChat(chat));
  }

  listAllChats(): Chat[] {
    const chats = this.db.chats.listAll();
    return chats.map((chat) => this.enrichChat(chat));
  }

  getChat(chatId: string): Chat | null {
    const active = this.activeChats.get(chatId);
    const chat = active ? active.chat : this.db.chats.get(chatId);
    if (!chat) return null;
    return this.enrichChat(chat);
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
      // loadHistory embeds the Claude sessionId as chatId — remap to Mainframe chatId
      const remapped = history.map((msg) => ({ ...msg, chatId }));
      if (remapped.length > 0) {
        this.messages.set(chatId, remapped);
        this.permissions.restorePendingPermission(chatId, remapped);
      }
      return remapped;
    } catch {
      /* best-effort: return empty if history loading fails */
      return [];
    }
  }

  /** Load messages from disk, bypassing the in-memory cache.
   * Used by the session-files route to include subagent file changes. */
  async getMessagesFromDisk(chatId: string): Promise<ChatMessage[]> {
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
      return history.map((msg) => ({ ...msg, chatId }));
    } catch (err) {
      logger.warn({ err, chatId }, 'getMessagesFromDisk failed');
      return [];
    }
  }

  async getDisplayMessages(chatId: string): Promise<DisplayMessage[]> {
    const raw = await this.getMessages(chatId);
    const chat = this.getChat(chatId);
    const adapter = chat ? this.adapters.get(chat.adapterId) : undefined;
    const categories = adapter?.getToolCategories?.();
    return prepareMessagesForClient(raw, categories);
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

  private enrichChat(chat: Chat): Chat {
    const hasPending = this.permissions.hasPending(chat.id);
    chat.displayStatus = hasPending ? 'waiting' : chat.processState === 'working' ? 'working' : 'idle';
    chat.isRunning = chat.processState === 'working' && !hasPending;
    chat.worktreeMissing = chat.worktreePath ? !existsSync(chat.worktreePath) : false;
    return chat;
  }

  private emitEvent(event: DaemonEvent): void {
    if (event.type === 'chat.updated' || event.type === 'chat.created') {
      this.enrichChat(event.chat);
    }
    this.onEvent(event);
  }
}
