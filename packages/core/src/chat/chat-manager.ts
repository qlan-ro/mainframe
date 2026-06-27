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
import type { ChatListFilters } from '../db/chats.js';
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
import { IdleSessionScanner } from './idle-scanner.js';
import type { ActiveChat } from './types.js';
import type { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { killTasksForChat } from '../background-tasks/kill.js';
import { wrapMainframeCommand } from '../commands/wrap.js';
import { findMainframeCommand } from '../commands/registry.js';
import { prepareMessagesForClient } from '../messages/display-pipeline.js';
import { resolveTuningForChat } from './resolve-tuning-for-chat.js';

const logger = createChildLogger('chat:manager');

interface QueuedItem {
  messageId: string;
  uuid: string;
  content: string;
  outgoingContent: string;
  images?: { mediaType: string; data: string }[];
  attachmentIds?: string[];
  timestamp: string;
}

export class ChatManager {
  private activeChats = new Map<string, ActiveChat>();
  private queuedRefs = new Map<string, QueuedMessageRef>();
  private chatQueues = new Map<string, QueuedItem[]>();
  private messages = new MessageCache();
  private permissions: PermissionManager;
  private planMode: PlanModeHandler;
  private permissionHandler: ChatPermissionHandler;
  private configManager: ChatConfigManager;
  private lifecycle: ChatLifecycleManager;
  private eventHandler: EventHandler;
  private externalSessions: ExternalSessionService;
  private idleScanner: IdleSessionScanner;

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private tracker: BackgroundTaskTracker,
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
      (chatId, uuid) => this.handleQueuedProcessed(chatId, uuid),
      (chatId) => this.clearAllQueuedForChat(chatId),
      (chatId) => this.getQueuedForChat(chatId),
    );
    this.planMode = new PlanModeHandler({
      permissions: this.permissions,
      messages: this.messages,
      db: this.db,
      adapters: this.adapters,
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
      buildSink: (chatId, sessionId, respondToPermission) =>
        this.eventHandler.buildSink(chatId, sessionId, respondToPermission),
      tracker: this.tracker,
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
      applyTuning: (chatId) => this.applyTuning(chatId),
    });
    this.externalSessions = new ExternalSessionService(this.db, this.adapters, (e) => this.emitEvent(e));
    this.idleScanner = new IdleSessionScanner(this.activeChats);
    this.idleScanner.start();
  }

  /**
   * On boot, no in-memory CLI sessions exist, so any persisted
   * `processState: 'working'` was orphaned by a previous daemon restart/crash.
   * Reset it to 'idle' so the UI doesn't treat the chat as running — otherwise a
   * new message queues forever ("sends after the current run") because there is
   * no live run to finish. A chat that was genuinely mid-run is interrupted by
   * the restart anyway (the CLI dies with the daemon), so 'idle' is correct.
   *
   * Call once at daemon boot, after construction (see `index.ts`).
   */
  recoverStaleWorkingState(): void {
    const count = this.db.chats.resetWorkingToIdle();
    logger.info({ count }, 'reset orphaned working chats to idle on boot');
  }

  /** Stop background timers. Idempotent. Tests and shutdown should call this. */
  dispose(): void {
    this.idleScanner.stop();
  }

  /** Exposed for tests — runs one idle-eviction pass immediately. */
  async scanIdleSessions(): Promise<void> {
    await this.idleScanner.scan();
  }

  /** Late-bind a callback to stop launch processes before worktree removal */
  setStopLaunchProcesses(fn: (projectId: string, projectPath: string) => Promise<void>): void {
    this.lifecycle.setStopLaunchProcesses(fn);
    this.configManager.setStopLaunchProcesses(fn);
  }

  setPushService(service: import('../push/push-service.js').PushService): void {
    this.eventHandler.setPushService(service);
    this.permissionHandler.setPushService(service);
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
    worktreePath?: string,
    branchName?: string,
  ): Promise<Chat> {
    return this.lifecycle.createChatWithDefaults(projectId, adapterId, model, permissionMode, worktreePath, branchName);
  }

  async resumeChat(chatId: string): Promise<void> {
    return this.lifecycle.resumeChat(chatId);
  }

  async updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: Chat['permissionMode'],
    planMode?: boolean,
  ): Promise<void> {
    return this.configManager.updateChatConfig(chatId, adapterId, model, permissionMode, planMode);
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

    // Only treat the message as queued for adapters whose protocol echoes a
    // per-message replay ack (Claude CLI stream-json). Adapters that consume
    // sendMessage synchronously (Codex turn/start, Claude SDK streamFollowUp)
    // never call `sink.onQueuedProcessed`, so leaving them on the queued path
    // would strand `queuedRefs` and pin `processState='working'` forever via
    // the new `getQueuedCount` gate in onResult.
    const adapterAcksReplay = postStart.session.supportsReplayAck === true;
    const isQueued = adapterAcksReplay && postStart.chat.processState === 'working';
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

    if (isQueued && messageUuid) {
      const item: QueuedItem = {
        messageId: message.id,
        uuid: messageUuid,
        content,
        outgoingContent: outgoingContent ?? '',
        images: images.length > 0 ? images : undefined,
        attachmentIds: attachmentIds?.length ? attachmentIds : undefined,
        timestamp: message.timestamp,
      };
      const list = this.chatQueues.get(chatId) ?? [];
      list.push(item);
      this.chatQueues.set(chatId, list);
      const ref: QueuedMessageRef = {
        messageId: item.messageId,
        chatId,
        uuid: item.uuid,
        content: item.content,
        attachmentIds: item.attachmentIds,
        timestamp: item.timestamp,
      };
      this.emitEvent({ type: 'message.queued', chatId, ref });
      logger.info({ chatId, uuid: messageUuid, messageId: message.id }, 'message held in daemon queue');
    } else {
      await postStart.session.sendMessage(outgoingContent, images.length > 0 ? images : undefined, undefined);
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

  /** Return all queued refs for a chat, oldest-first. */
  getQueuedForChat(chatId: string): QueuedMessageRef[] {
    return (this.chatQueues.get(chatId) ?? []).map((i) => ({
      messageId: i.messageId,
      chatId,
      uuid: i.uuid,
      content: i.content,
      attachmentIds: i.attachmentIds,
      timestamp: i.timestamp,
    }));
  }

  /** Drop every queuedRef belonging to a chat. Called when the CLI process exits. */
  clearAllQueuedForChat(chatId: string): void {
    let removed = 0;
    for (const [uuid, ref] of this.queuedRefs) {
      if (ref.chatId === chatId) {
        this.queuedRefs.delete(uuid);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info({ chatId, removed }, 'cleared queued refs for exited chat');
    }
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
    this.tracker.removeChat(chatId);
    this.eventHandler.clearDisplayCache(chatId);
  }

  unarchiveChat(chatId: string): Chat | null {
    this.db.chats.update(chatId, { status: 'active' });
    const chat = this.db.chats.get(chatId);
    if (!chat) return null;
    this.emitEvent({ type: 'chat.updated', chat });
    return chat;
  }

  async endChat(chatId: string): Promise<void> {
    await this.lifecycle.endChat(chatId);
    this.tracker.removeChat(chatId);
    this.eventHandler.clearDisplayCache(chatId);
  }

  async removeProject(projectId: string): Promise<void> {
    logger.info({ projectId }, 'project removed');
    const chats = this.db.chats.list(projectId);
    for (const chat of chats) {
      const active = this.activeChats.get(chat.id);
      try {
        await killTasksForChat({
          chatId: chat.id,
          worktreePath: chat.worktreePath ?? undefined,
          session: active?.session ?? null,
          tracker: this.tracker,
        });
      } catch (err) {
        logger.warn({ err, chatId: chat.id }, 'killTasksForChat failed on project removal');
      }
      if (active?.session) {
        try {
          await active.session.kill();
        } catch (err) {
          logger.warn({ err, chatId: chat.id }, 'session.kill failed on project removal');
        }
      }
      this.activeChats.delete(chat.id);
      this.messages.delete(chat.id);
      this.permissions.clear(chat.id);
      this.tracker.removeChat(chat.id);
      this.eventHandler.clearDisplayCache(chat.id);
    }
    this.db.projects.remove(projectId);
  }

  listChats(projectId: string): Chat[] {
    const chats = this.db.chats.list(projectId);
    return chats.map((chat) => this.enrichChat(chat));
  }

  listAllChats(): Chat[] {
    const chats = this.db.chats.listAll();
    return chats.map((chat) => this.enrichChat(chat));
  }

  listFiltered(filters: ChatListFilters): Chat[] {
    const chats = this.db.chats.listFiltered(filters);
    return chats.map((chat) => this.enrichChat(chat));
  }

  /** Re-emit chat.updated for every non-archived chat bound to the given worktree path so clients pick up the new worktreeMissing flag. */
  notifyWorktreeDeleted(worktreePath: string): void {
    for (const raw of this.db.chats.listAll()) {
      if (raw.worktreePath !== worktreePath) continue;
      const enriched = this.enrichChat(raw);
      this.emitEvent({ type: 'chat.updated', chat: enriched });
    }
  }

  /**
   * Broadcast `chat.updated` for a chat whose fields were persisted out-of-band
   * (e.g. the tuning PATCH writes effort/features straight to the DB). Without
   * this, a server-authoritative client never learns of the change until the
   * next unrelated `chat.updated` — the composer effort/feature chip would stay
   * stale. Mirrors `notifyWorktreeDeleted`'s enriched re-emit.
   */
  emitChatUpdated(chatId: string): void {
    const chat = this.getChat(chatId);
    if (chat) this.emitEvent({ type: 'chat.updated', chat });
  }

  getChat(chatId: string): Chat | null {
    const active = this.activeChats.get(chatId);
    const chat = active ? active.chat : this.db.chats.get(chatId);
    if (!chat) return null;
    return this.enrichChat(chat);
  }

  /**
   * Sync the in-memory tags of a cached active chat. The tags route persists
   * to the DB, but `activeChats[id].chat.tags` would otherwise stay stale and
   * a later `chat.updated` emission (e.g. from resumeChat) would broadcast the
   * old tags and clobber the renderer's store.
   */
  syncChatTags(chatId: string, tags: string[]): void {
    const active = this.activeChats.get(chatId);
    if (active) active.chat.tags = tags;
  }

  /**
   * Apply a partial DB-backed update to the in-memory cached chat. Same reason
   * as syncChatTags: any field persisted via a PATCH route that isn't mirrored
   * here will be clobbered the next time `resumeChat` re-emits `chat.updated`
   * from the stale cache.
   */
  syncChatFields(chatId: string, partial: Partial<Chat>): void {
    const active = this.activeChats.get(chatId);
    if (!active) return;
    Object.assign(active.chat, partial);
  }

  /**
   * Live-applies resolved tuning to the running session for this chat, if any.
   * If no session is active, tuning is picked up at next spawn.
   */
  async applyTuning(chatId: string): Promise<void> {
    const session = this.activeChats.get(chatId)?.session;
    if (!session?.applyTuning) return; // no live session → applied at next spawn
    const resolved = await resolveTuningForChat({ db: this.db, adapters: this.adapters }, chatId);
    if (!resolved) return;
    try {
      await session.applyTuning(resolved);
    } catch (err) {
      logger.warn({ err, chatId }, 'live applyTuning failed');
    }
  }

  /**
   * Returns the working directory for `chatId`:
   * - the chat's worktree path when it has one and the directory still exists;
   * - the project root otherwise.
   *
   * Returns `null` when the chat is unknown, the project is unknown, or the
   * chat's worktree has been deleted (`worktreeMissing === true`).
   * Callers that need to distinguish "worktree missing" from "chat not found"
   * should check `getChat(chatId)?.worktreeMissing` after receiving `null`.
   */
  getEffectivePath(chatId: string): string | null {
    const chat = this.getChat(chatId);
    if (!chat) return null;
    if (chat.worktreePath) {
      if (chat.worktreeMissing) return null;
      return chat.worktreePath;
    }
    const project = this.db.projects.get(chat.projectId);
    return project?.path ?? null;
  }

  /** Returns the root path for a project, or null if the project is not found. */
  getProjectPath(projectId: string): string | null {
    return this.db.projects.get(projectId)?.path ?? null;
  }

  /** Returns the projectId that owns the given chat, or null if the chat is not found. */
  getChatProjectId(chatId: string): string | null {
    return this.getChat(chatId)?.projectId ?? null;
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
        mainframeChatId: chatId,
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
        mainframeChatId: chatId,
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

  /**
   * Returns the live AdapterSession for a chat, if a process is running.
   * Used by the background-tasks routes to dispatch stop_task control_requests.
   * Returns null when the chat is not active (no spawned CLI process).
   */
  getSessionForChat(chatId: string): import('@qlan-ro/mainframe-types').AdapterSession | null {
    const active = this.activeChats.get(chatId);
    return active?.session ?? null;
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
