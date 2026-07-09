import { homedir } from 'node:os';
import { join } from 'node:path';
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
  QueuedMessageRef,
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

export function computeSessionFilePath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  const safeSession = sessionId.replace(/[^a-zA-Z0-9-]/g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${safeSession}.jsonl`);
}

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
    private getQueuedRefs: (chatId: string) => QueuedMessageRef[] = () => [],
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
      this.getQueuedRefs,
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
  getQueuedRefs: (chatId: string) => QueuedMessageRef[],
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
      const projectPath = db.projects.get(active.chat.projectId)?.path;
      const cwd = active.chat.worktreePath ?? projectPath;
      if (cwd) {
        const sessionFilePath = computeSessionFilePath(cwd, sessionId);
        db.chats.update(chatId, { sessionFilePath });
        active.chat.sessionFilePath = sessionFilePath;
      }
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

      log.debug(
        { chatId, sessionId: active.session?.id, subtype: data.subtype, is_error: data.is_error },
        'onResult: processing session result',
      );

      const cost = data.total_cost_usd ?? 0;
      const tokensInput = data.usage?.input_tokens ?? 0;
      const tokensOutput = data.usage?.output_tokens ?? 0;

      const newCost = active.chat.totalCost + cost;
      const newInput = active.chat.totalTokensInput + tokensInput;
      const newOutput = active.chat.totalTokensOutput + tokensOutput;
      // Bump updatedAt so the session resurfaces to the top of the list when
      // the AI finishes a turn, not only when the user sends a message.
      const now = new Date().toISOString();

      // Reconcile cached metadata.queued ↔ chat-manager queuedRefs. The CLI's
      // isReplay acks can race with our queuedRefs.set (the daemon registers
      // the ref AFTER awaiting stdin.write; the CLI may already have ack'd),
      // and renderer-side `queuedMessages` can drift from the daemon when
      // events arrive out of order. We recompute the canonical state here on
      // every result event:
      //   1. cached msg has metadata.queued but no matching ref → orphan flag.
      //      Strip the flag + emit message.queued.processed for the renderer.
      //   2. ref has no matching cached msg → orphan ref. Drop it + ack.
      //   3. Emit a queued.snapshot afterwards so the renderer's composer
      //      converges on whatever refs the daemon believes are still live.
      const refsBefore = getQueuedRefs(chatId);
      const refUuids = new Set(refsBefore.map((r) => r.uuid));
      const cached = messages.get(chatId) ?? [];
      const cachedQueuedUuids = new Set<string>();
      let displayChanged = false;

      // Iterate a snapshot: moveToEnd splices+pushes on the live `cached` array,
      // and mutating an array mid-for-of shifts the iterator, silently skipping
      // whichever orphan lands in the vacated slot.
      for (const m of [...cached]) {
        const u = m.metadata?.uuid;
        if (m.metadata?.queued && typeof u === 'string') {
          cachedQueuedUuids.add(u);
          if (!refUuids.has(u)) {
            delete (m.metadata as Record<string, unknown>).queued;
            delete (m.metadata as Record<string, unknown>).uuid;
            messages.moveToEnd(chatId, m.id);
            displayChanged = true;
            log.warn({ chatId, uuid: u }, 'onResult: orphan metadata.queued (no matching ref) — clearing');
            emitEvent({ type: 'message.queued.processed', chatId, uuid: u });
            onQueuedProcessedCb(chatId, u);
          }
        }
      }

      for (const ref of refsBefore) {
        if (!cachedQueuedUuids.has(ref.uuid)) {
          log.warn({ chatId, uuid: ref.uuid }, 'onResult: orphan queuedRef (no matching cached message) — pruning');
          emitEvent({ type: 'message.queued.processed', chatId, uuid: ref.uuid });
          onQueuedProcessedCb(chatId, ref.uuid);
        }
      }

      if (displayChanged) emitDisplay();

      // Force renderer composer to converge on the daemon's refs. Defends
      // against any out-of-order delivery / dedupe gap that could leave the
      // renderer's queuedMessages map with stale entries.
      const refsAfter = getQueuedRefs(chatId);
      emitEvent({ type: 'message.queued.snapshot', chatId, refs: refsAfter });

      // Result events fire per-turn. While queued messages are still pending
      // we must NOT flip to idle here, or the thinking indicator drops while
      // the assistant is still streaming the next queued turn. Use the count
      // AFTER reconciliation so orphan refs don't pin the state to 'working'
      // when the CLI is genuinely done.
      const queueRemaining = refsAfter.length;
      const nextProcessState: 'idle' | 'working' = queueRemaining > 0 ? 'working' : 'idle';

      // Context size: prefer the adapter's explicit per-turn report
      // (`contextTokens`; null = "unknown this turn — keep the stored value").
      // Legacy adapters without the field fall back to the turn's usage, but a
      // zero must never clobber a real stored size (synthetic/EMPTY_USAGE turns).
      const contextTokens = data.contextTokens === undefined ? tokensInput : data.contextTokens;
      const contextUpdate = contextTokens != null && contextTokens > 0 ? { lastContextTokensInput: contextTokens } : {};

      db.chats.update(chatId, {
        totalCost: newCost,
        totalTokensInput: newInput,
        totalTokensOutput: newOutput,
        ...contextUpdate,
        processState: nextProcessState,
        updatedAt: now,
      });
      active.chat.totalCost = newCost;
      active.chat.totalTokensInput = newInput;
      active.chat.totalTokensOutput = newOutput;
      if (contextUpdate.lastContextTokensInput != null) {
        active.chat.lastContextTokensInput = contextUpdate.lastContextTokensInput;
      }
      active.chat.processState = nextProcessState;
      active.chat.updatedAt = now;

      // Check interrupted flag before clearing permissions (clear() wipes both).
      const wasInterrupted = permissions.clearInterrupted(chatId);
      // CLI process ended — clear stale permissions so displayStatus reflects
      // 'idle'. Permission state is reconstructed from JSONL on next loadChat.
      permissions.clear(chatId);

      const isError = data.subtype === 'error_during_execution' && data.is_error !== false;
      const reason = wasInterrupted ? 'interrupted' : isError ? 'error' : 'completed';
      log.debug({ chatId, reason, wasInterrupted, isError }, 'onResult: emitting chat.updated with processState=idle');
      emitEvent({ type: 'chat.updated', chat: active.chat, reason });

      // Turn duration for the MessageTiming pill. `turnStartedAt` is stamped by
      // ChatManager.sendMessage right before dispatch; emit it as a transient
      // `system` marker that groupMessages() merges onto the preceding
      // assistant turn as `metadata.turnDurationMs` and then discards.
      if (typeof active.turnStartedAt === 'number') {
        const turnDurationMs = Date.now() - active.turnStartedAt;
        active.turnStartedAt = undefined;
        const timingMessage = messages.createTransientMessage(chatId, 'system', [], { turnDurationMs });
        messages.append(chatId, timingMessage);
        emitEvent({ type: 'message.added', chatId, message: timingMessage });
        emitDisplay();
      }

      const notifyConfig = readNotificationConfig(db);
      if (isError) {
        if (!wasInterrupted) {
          const detail = typeof data.result === 'string' ? data.result.trim() : '';
          log.warn(
            { chatId, subtype: data.subtype, reason: detail || null },
            'session ended unexpectedly — emitting error message',
          );
          const message = messages.createTransientMessage(chatId, 'error', [
            { type: 'error', message: detail || 'Session ended unexpectedly' },
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
      log.debug({ chatId, uuid }, 'onQueuedProcessed: moving queued message to end + clearing flag');
      const msgs = messages.get(chatId);
      const msg = msgs?.find((m) => m.metadata?.uuid === uuid);
      if (msg?.metadata) {
        delete (msg.metadata as Record<string, unknown>).queued;
        delete (msg.metadata as Record<string, unknown>).uuid;
        // Move on process: the ack fires when the CLI injects this message into
        // context, so relocating it to the end matches the JSONL consumption
        // point. Reloads no longer reshuffle order.
        messages.moveToEnd(chatId, msg.id);
        emitDisplay();
      } else {
        log.warn({ chatId, uuid }, 'onQueuedProcessed: message not found in cache or already processed');
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
      // is gone and will never emit an isReplay ack for them. Clear the
      // cached flags so the composer banner doesn't leak.
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
      const message = messages.createTransientMessage(chatId, 'system', [{ type: 'compaction' }]);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
      emitEvent({ type: 'chat.compactDone', chatId });
      emitDisplay();
    },

    onCompactStart() {
      emitEvent({ type: 'chat.compacting', chatId });
    },

    onContextUsage(usage: ContextUsage) {
      // Persist the CLI's own totals so the meter survives reloads and
      // dormant-chat turns instead of regressing to a catalog-window guess
      // (#197). `chat.updated` is broadcast ungated (unlike chat.contextUsage,
      // which only reaches subscribers), so unsubscribed clients converge too.
      if (usage.maxTokens > 0) {
        db.chats.update(chatId, {
          lastContextTotalTokens: usage.totalTokens,
          lastContextMaxTokens: usage.maxTokens,
        });
        const active = getActiveChat(chatId);
        if (active) {
          active.chat.lastContextTotalTokens = usage.totalTokens;
          active.chat.lastContextMaxTokens = usage.maxTokens;
          emitEvent({ type: 'chat.updated', chat: active.chat });
        }
      }
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
      // Persist before emitting so reconnecting renderers / sidebar entries
      // that never trigger a loadChat see the PR via the DB-backed Chat row.
      // Suppress the WS event when addDetectedPrs reports no change — avoids
      // re-emitting on every duplicate sighting from the live stream.
      const persisted = db.chats.addDetectedPrs(chatId, [pr]);
      if (persisted.length === 0) return;
      emitEvent({ type: 'chat.prDetected', chatId, pr: persisted[0]! });
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

    onSubagentChild(parentToolUseId: string, blocks: import('@qlan-ro/mainframe-types').MessageContent[]) {
      const cached = messages.get(chatId);
      if (!cached) {
        log.warn(
          { chatId, parentToolUseId, blockCount: blocks.length },
          'onSubagentChild: no messages in cache; dropping blocks',
        );
        return;
      }
      // Walk newest-first: subagent events belong to the most recent assistant
      // message that contains the parent tool_use.
      for (let i = cached.length - 1; i >= 0; i--) {
        const msg = cached[i]!;
        if (msg.type !== 'assistant') continue;
        const owns = msg.content.some((b) => b.type === 'tool_use' && b.id === parentToolUseId);
        if (!owns) continue;
        msg.content = [...msg.content, ...blocks];
        emitEvent({ type: 'message.updated', chatId, message: msg });
        emitDisplay();
        return;
      }
      log.warn(
        { chatId, parentToolUseId, blockCount: blocks.length },
        'onSubagentChild: parent tool_use not found in cache; dropping blocks',
      );
    },

    onError(error: Error) {
      emitEvent({ type: 'error', chatId, error: error.message });
    },

    onTrustRequired(projectPath: string) {
      emitEvent({ type: 'chat.trustRequired', chatId, projectPath });
    },
  };
}
