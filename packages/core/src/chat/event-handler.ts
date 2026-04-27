import type {
  DaemonEvent,
  DisplayMessage,
  SessionSink,
  ControlResponse,
  SessionResult,
  SkillFileEntry,
  MessageMetadata,
  ToolCategories,
  ContextUsage,
} from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';
import type { PushService } from '../push/push-service.js';
import { stripMainframeCommandTags } from '../messages/message-parsing.js';
import { emitDisplayDelta } from './display-emitter.js';
import { createChildLogger } from '../logger.js';
import { readNotificationConfig, shouldNotifyPermission } from '../notifications/notification-config.js';

const log = createChildLogger('chat:events');

const PUSH_BODY_MAX_LENGTH = 200;

function getLastAssistantText(msgs: import('@qlan-ro/mainframe-types').ChatMessage[] | undefined): string {
  if (!msgs) return '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    if (msg.type !== 'assistant') continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]!;
      if (block.type === 'text' && block.text.trim()) {
        const text = block.text.trim();
        if (text.length <= PUSH_BODY_MAX_LENGTH) return text;
        return text.slice(0, PUSH_BODY_MAX_LENGTH - 1) + '…';
      }
    }
  }
  return '';
}

export class EventHandler {
  private displayCache = new Map<string, DisplayMessage[]>();
  private pushService?: PushService;

  constructor(
    private db: DatabaseManager,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private getActiveChat: (chatId: string) => ActiveChat | undefined,
    private emitEvent: (event: DaemonEvent) => void,
    private getToolCategories: (chatId: string) => ToolCategories | undefined = () => undefined,
    private onQueuedProcessed: (chatId: string, uuid: string) => void = () => {},
    private onQueuedCleared: (chatId: string) => void = () => {},
  ) {}

  setPushService(service: PushService): void {
    this.pushService = service;
  }

  buildSink(
    chatId: string,
    sessionIdOrRespondToPermission: string | ((response: ControlResponse) => Promise<void>),
    maybeRespondToPermission?: (response: ControlResponse) => Promise<void>,
  ): SessionSink {
    const builtForSessionId =
      typeof sessionIdOrRespondToPermission === 'string' ? sessionIdOrRespondToPermission : undefined;
    const respondToPermission =
      typeof sessionIdOrRespondToPermission === 'string' ? maybeRespondToPermission : sessionIdOrRespondToPermission;
    if (!respondToPermission) throw new Error('respondToPermission is required');

    return buildSessionSink(
      chatId,
      builtForSessionId,
      this.db,
      this.messages,
      this.permissions,
      this.getActiveChat,
      this.emitEvent,
      respondToPermission,
      this.displayCache,
      this.getToolCategories,
      this.onQueuedProcessed,
      this.onQueuedCleared,
      this.pushService,
    );
  }

  /** Emit display delta for a chat (for use by code paths outside the session sink). */
  emitDisplay(chatId: string): void {
    const categories = this.getToolCategories(chatId);
    emitDisplayDelta(chatId, this.messages, this.displayCache, categories, this.emitEvent);
  }

  /** Remove display cache entry for a chat (call on chat end/archive). */
  clearDisplayCache(chatId: string): void {
    this.displayCache.delete(chatId);
  }
}

function buildSessionSink(
  chatId: string,
  builtForSessionId: string | undefined,
  db: DatabaseManager,
  messages: MessageCache,
  permissions: PermissionManager,
  getActiveChat: (chatId: string) => ActiveChat | undefined,
  emitEvent: (event: DaemonEvent) => void,
  _respondToPermission: (response: ControlResponse) => Promise<void>,
  displayCache: Map<string, DisplayMessage[]>,
  getToolCategories: (chatId: string) => ToolCategories | undefined,
  onQueuedProcessedCb: (chatId: string, uuid: string) => void,
  onQueuedClearedCb: (chatId: string) => void,
  pushService?: PushService,
): SessionSink {
  function emitDisplay(): void {
    const categories = getToolCategories(chatId);
    emitDisplayDelta(chatId, messages, displayCache, categories, emitEvent);
  }

  // Track tool_use id → file_path so onToolResult can emit context.updated
  // with the affected paths after the tool has executed.
  const pendingFilePaths = new Map<string, string>();
  // Track subagent tool_use ids (Task/Agent) so onToolResult can emit
  // context.updated when a subagent completes, triggering a diffs refresh.
  const pendingSubagentIds = new Set<string>();

  return {
    onInit(sessionId: string) {
      const active = getActiveChat(chatId);
      if (!active) return;
      db.chats.update(chatId, { claudeSessionId: sessionId });
      active.chat.claudeSessionId = sessionId;
      emitEvent({ type: 'process.ready', processId: active.session?.id ?? '', claudeSessionId: sessionId });
    },

    onMessage(content: any[], metadata?: MessageMetadata) {
      log.debug({ chatId, blockCount: content.length }, 'assistant message received');
      const categories = getToolCategories(chatId);
      for (const block of content) {
        if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
          const fp = (block.input as Record<string, unknown>)?.file_path as string | undefined;
          if (fp) pendingFilePaths.set(block.id as string, fp);
        }
        if (block.type === 'tool_use' && categories?.subagent.has(block.name as string)) {
          pendingSubagentIds.add(block.id as string);
        }
      }
      const hasEnterPlanMode = content.some((b: any) => b.type === 'tool_use' && b.name === 'EnterPlanMode');
      if (hasEnterPlanMode) {
        const active = getActiveChat(chatId);
        if (active && active.chat.planMode !== true) {
          db.chats.update(chatId, { planMode: true });
          active.chat.planMode = true;
          emitEvent({ type: 'chat.updated', chat: active.chat });
        }
      }

      // Strip mainframe command response tags from assistant text blocks
      const cleaned = content.map((block: any) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          const stripped = stripMainframeCommandTags(block.text);
          return stripped !== block.text ? { ...block, text: stripped } : block;
        }
        return block;
      });

      const msgMeta: Record<string, unknown> = {
        adapterId: getActiveChat(chatId)?.session?.adapterId,
        ...(metadata ? { model: metadata.model, usage: metadata.usage } : {}),
      };
      const message = messages.createTransientMessage(chatId, 'assistant', cleaned, msgMeta);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitDisplay();
    },

    onToolResult(content: any[]) {
      const editedPaths: string[] = [];
      let subagentCompleted = false;
      for (const block of content) {
        if (block.type !== 'tool_result' || block.isError) continue;
        const fp = pendingFilePaths.get(block.toolUseId);
        if (fp) {
          editedPaths.push(fp);
          pendingFilePaths.delete(block.toolUseId);
        }
        if (pendingSubagentIds.has(block.toolUseId)) {
          pendingSubagentIds.delete(block.toolUseId);
          subagentCompleted = true;
        }
      }

      const message = messages.createTransientMessage(chatId, 'tool_result', content);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitDisplay();

      if (editedPaths.length > 0) {
        emitEvent({ type: 'context.updated', chatId, filePaths: editedPaths });
      } else if (subagentCompleted) {
        // Subagents write files through their own JSONL files, not the parent stream.
        // Emit context.updated so the frontend refreshes the session diffs from disk.
        emitEvent({ type: 'context.updated', chatId });
      }
    },

    onPermission(request: any) {
      const isFirst = permissions.enqueue(chatId, request);
      if (isFirst) {
        log.info(
          { chatId, requestId: request.requestId, toolName: request.toolName },
          'permission.requested emitted to clients',
        );
        const notifyConfig = readNotificationConfig(db);
        const notify = shouldNotifyPermission(notifyConfig, request.toolName);
        emitEvent({ type: 'permission.requested', chatId, request, notify });

        // Emit chat.updated so displayStatus flips to 'waiting' on clients
        const active = getActiveChat(chatId);
        if (active) {
          emitEvent({ type: 'chat.updated', chat: active.chat });
        }

        if (notify) {
          pushService
            ?.sendPush({
              title: 'Permission Required',
              body: `Agent wants to run: ${request.toolName ?? 'unknown tool'}`,
              data: { chatId, type: 'permission' },
              priority: 'high',
            })
            .catch((err) => log.warn({ err }, 'push notification failed'));
        }
      } else {
        log.info(
          { chatId, requestId: request.requestId, toolName: request.toolName },
          'permission queued (another already pending)',
        );
      }
    },

    onResult(data: SessionResult) {
      const active = getActiveChat(chatId);
      if (!active) return;

      const cost = data.total_cost_usd ?? 0;
      const tokensInput = data.usage?.input_tokens ?? 0;
      const tokensOutput = data.usage?.output_tokens ?? 0;

      const newCost = active.chat.totalCost + cost;
      const newInput = active.chat.totalTokensInput + tokensInput;
      const newOutput = active.chat.totalTokensOutput + tokensOutput;
      // Bump updatedAt so the session resurfaces to the top of the list when
      // the AI finishes a turn, not only when the user sends a message.
      const now = new Date().toISOString();

      db.chats.update(chatId, {
        totalCost: newCost,
        totalTokensInput: newInput,
        totalTokensOutput: newOutput,
        lastContextTokensInput: tokensInput,
        processState: 'idle',
        updatedAt: now,
      });
      active.chat.totalCost = newCost;
      active.chat.totalTokensInput = newInput;
      active.chat.totalTokensOutput = newOutput;
      active.chat.lastContextTokensInput = tokensInput;
      active.chat.processState = 'idle';
      active.chat.updatedAt = now;
      // Check interrupted flag before clearing permissions (clear() wipes both).
      const wasInterrupted = permissions.clearInterrupted(chatId);
      // CLI process ended — clear stale permissions so displayStatus reflects
      // 'idle'. Permission state is reconstructed from JSONL on next loadChat.
      permissions.clear(chatId);

      const isError = data.subtype === 'error_during_execution' && data.is_error !== false;
      const reason = wasInterrupted ? 'interrupted' : isError ? 'error' : 'completed';
      emitEvent({ type: 'chat.updated', chat: active.chat, reason });

      const notifyConfig = readNotificationConfig(db);
      if (isError) {
        if (!wasInterrupted) {
          const message = messages.createTransientMessage(chatId, 'error', [
            { type: 'error', message: 'Session ended unexpectedly' },
          ]);
          messages.append(chatId, message);
          emitEvent({ type: 'message.added', chatId, message });
          emitDisplay();

          if (notifyConfig.chat.sessionError) {
            const notification = { title: 'Session Error', body: 'A session ended unexpectedly' };
            emitEvent({ type: 'chat.notification', chatId, ...notification, level: 'error' });
            pushService
              ?.sendPush({ ...notification, data: { chatId, type: 'error' }, priority: 'high' })
              .catch((err) => log.warn({ err }, 'push notification failed'));
          }
        }
      } else if (notifyConfig.chat.taskComplete) {
        const lastText = getLastAssistantText(messages.get(chatId));
        const notification = {
          title: 'Task Complete',
          body: lastText || `Session finished (cost: $${cost.toFixed(4)})`,
        };
        emitEvent({ type: 'chat.notification', chatId, ...notification, level: 'success' });
        pushService
          ?.sendPush({ ...notification, data: { chatId, type: 'task_complete' }, priority: 'default' })
          .catch((err) => log.warn({ err }, 'push notification failed'));
      }

      // Per-queued-uuid cleanup happens in onQueuedProcessed (driven by the
      // CLI's isReplay acks under --replay-user-messages). Don't bulk-clear
      // on turn completion — that strips metadata.queued from messages the
      // CLI hasn't dequeued yet.
    },

    onQueuedProcessed(uuid: string) {
      const msgs = messages.get(chatId);
      const msg = msgs?.find((m) => m.metadata?.uuid === uuid);
      if (msg?.metadata) {
        delete (msg.metadata as Record<string, unknown>).queued;
        delete (msg.metadata as Record<string, unknown>).uuid;
        emitDisplay();
      }
      emitEvent({ type: 'message.queued.processed', chatId, uuid });
      onQueuedProcessedCb(chatId, uuid);
    },

    onExit(_code: number | null) {
      const active = getActiveChat(chatId);
      if (builtForSessionId && active?.session && active.session.id !== builtForSessionId) {
        return;
      }
      const sessionId = active?.session?.id ?? '';
      log.debug({ sessionId, chatId }, 'session exited');

      // Any messages still flagged as queued are stranded — the CLI process
      // is gone and will never emit an isReplay ack for them. Clear here so
      // the composer banner and the daemon's queuedRefs don't leak.
      const cachedMsgs = messages.get(chatId);
      let hadQueued = false;
      if (cachedMsgs) {
        for (const msg of cachedMsgs) {
          if (msg.metadata?.queued) {
            delete (msg.metadata as Record<string, unknown>).queued;
            delete (msg.metadata as Record<string, unknown>).uuid;
            hadQueued = true;
          }
        }
      }
      if (hadQueued) {
        emitDisplay();
        emitEvent({ type: 'message.queued.cleared', chatId });
      }
      onQueuedClearedCb(chatId);

      if (active) {
        active.chat.processState = null;
        db.chats.update(chatId, { processState: null });
        emitEvent({ type: 'chat.updated', chat: active.chat });
      }
      emitEvent({ type: 'process.stopped', processId: sessionId });
    },

    onCompact() {
      const message = messages.createTransientMessage(chatId, 'system', [{ type: 'text', text: 'Context compacted' }]);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitEvent({ type: 'chat.compactDone', chatId });
      emitDisplay();
    },

    onCompactStart() {
      emitEvent({ type: 'chat.compacting', chatId });
    },

    onContextUsage(usage: ContextUsage) {
      emitEvent({ type: 'chat.contextUsage', chatId, ...usage });
    },

    onPlanFile(filePath: string) {
      if (db.chats.addPlanFile(chatId, filePath)) {
        emitEvent({ type: 'context.updated', chatId });
      }
    },

    onSkillFile(entry: SkillFileEntry) {
      // The SkillLoadedCard (emitted via onSkillLoaded) already tells the user
      // which skill was loaded — no separate announcement message needed.
      if (db.chats.addSkillFile(chatId, entry)) {
        emitEvent({ type: 'context.updated', chatId });
      }
    },

    onTodoUpdate(todos: import('@qlan-ro/mainframe-types').TodoItem[]) {
      db.chats.updateTodos(chatId, todos);
      const active = getActiveChat(chatId);
      if (active) active.chat.todos = todos;
      emitEvent({ type: 'todos.updated', chatId, todos });
    },

    onPrDetected(pr: import('@qlan-ro/mainframe-types').DetectedPr) {
      emitEvent({ type: 'chat.prDetected', chatId, pr });
    },

    onCliMessage(text: string) {
      const message = messages.createTransientMessage(chatId, 'system', [{ type: 'text', text }]);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitDisplay();
    },

    onSkillLoaded(entry: { skillName: string; path: string; content: string }) {
      const message = messages.createTransientMessage(chatId, 'system', [
        { type: 'skill_loaded', skillName: entry.skillName, path: entry.path, content: entry.content },
      ]);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitDisplay();
    },

    onError(error: Error) {
      emitEvent({ type: 'error', chatId, error: error.message });
    },
  };
}
