import type {
  DaemonEvent,
  SessionSink,
  ControlResponse,
  SessionResult,
  SkillFileEntry,
  MessageMetadata,
} from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';
import { trackFileActivity } from './context-tracker.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('chat:events');

export class EventHandler {
  constructor(
    private db: DatabaseManager,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private getActiveChat: (chatId: string) => ActiveChat | undefined,
    private emitEvent: (event: DaemonEvent) => void,
  ) {}

  buildSink(chatId: string, respondToPermission: (response: ControlResponse) => Promise<void>): SessionSink {
    return buildSessionSink(
      chatId,
      this.db,
      this.messages,
      this.permissions,
      this.getActiveChat,
      this.emitEvent,
      respondToPermission,
    );
  }
}

function buildSessionSink(
  chatId: string,
  db: DatabaseManager,
  messages: MessageCache,
  permissions: PermissionManager,
  getActiveChat: (chatId: string) => ActiveChat | undefined,
  emitEvent: (event: DaemonEvent) => void,
  respondToPermission: (response: ControlResponse) => Promise<void>,
): SessionSink {
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
      if (trackFileActivity(chatId, content, db, undefined)) {
        emitEvent({ type: 'context.updated', chatId });
      }
      const hasEnterPlanMode = content.some((b: any) => b.type === 'tool_use' && b.name === 'EnterPlanMode');
      if (hasEnterPlanMode) {
        const active = getActiveChat(chatId);
        if (active && active.chat.permissionMode !== 'plan') {
          db.chats.update(chatId, { permissionMode: 'plan' });
          active.chat.permissionMode = 'plan';
          emitEvent({ type: 'chat.updated', chat: active.chat });
        }
      }
      const msgMeta: Record<string, unknown> = {
        adapterId: getActiveChat(chatId)?.session?.adapterId,
        ...(metadata ? { model: metadata.model, usage: metadata.usage } : {}),
      };
      const message = messages.createTransientMessage(chatId, 'assistant', content, msgMeta);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
    },

    onToolResult(content: any[]) {
      const message = messages.createTransientMessage(chatId, 'tool_result', content);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
    },

    onPermission(request: any) {
      const active = getActiveChat(chatId);
      const mode = active?.chat.permissionMode;

      // Interactive tools require real user input even in yolo mode.
      const requiresUserInput = request.toolName === 'AskUserQuestion' || request.toolName === 'ExitPlanMode';
      if (mode === 'yolo' && !requiresUserInput) {
        respondToPermission({
          requestId: request.requestId,
          toolUseId: request.toolUseId,
          behavior: 'allow',
          updatedInput: request.input,
        }).catch((err) => log.warn({ err, chatId }, 'yolo auto-approve failed'));
        return;
      }

      const isFirst = permissions.enqueue(chatId, request);
      if (isFirst) {
        log.info(
          { chatId, requestId: request.requestId, toolName: request.toolName },
          'permission.requested emitted to clients',
        );
        emitEvent({ type: 'permission.requested', chatId, request });
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

      db.chats.update(chatId, {
        totalCost: newCost,
        totalTokensInput: newInput,
        totalTokensOutput: newOutput,
        lastContextTokensInput: tokensInput,
        processState: 'idle',
      });
      active.chat.totalCost = newCost;
      active.chat.totalTokensInput = newInput;
      active.chat.totalTokensOutput = newOutput;
      active.chat.lastContextTokensInput = tokensInput;
      active.chat.processState = 'idle';
      emitEvent({ type: 'chat.updated', chat: active.chat });

      if (data.subtype === 'error_during_execution' && data.is_error !== false) {
        const wasInterrupted = permissions.clearInterrupted(chatId);
        if (!wasInterrupted) {
          const message = messages.createTransientMessage(chatId, 'error', [
            { type: 'error', message: 'Session ended unexpectedly' },
          ]);
          messages.append(chatId, message);
          emitEvent({ type: 'message.added', chatId, message });
        }
      } else {
        permissions.clearInterrupted(chatId);
      }
    },

    onExit(_code: number | null) {
      const active = getActiveChat(chatId);
      const sessionId = active?.session?.id ?? '';
      log.debug({ sessionId, chatId }, 'session exited');
      if (active) {
        active.chat.processState = null;
        db.chats.update(chatId, { processState: null });
      }
      emitEvent({ type: 'process.stopped', processId: sessionId });
    },

    onCompact() {
      const message = messages.createTransientMessage(chatId, 'system', [{ type: 'text', text: 'Context compacted' }]);
      messages.append(chatId, message);
      emitEvent({ type: 'message.added', chatId, message });
    },

    onPlanFile(filePath: string) {
      if (db.chats.addPlanFile(chatId, filePath)) {
        emitEvent({ type: 'context.updated', chatId });
      }
    },

    onSkillFile(entry: SkillFileEntry) {
      // Autonomous Skill-tool flows emit a tool_result containing "Launching skill:" before
      // the isMeta skill content arrives. Slash-command flows do not, so we add an
      // announcement message to confirm the skill was loaded.
      const cachedMessages = messages.get(chatId) ?? [];
      const lastMsg = cachedMessages[cachedMessages.length - 1];
      const isAutonomousFlow =
        lastMsg?.type === 'tool_result' &&
        lastMsg.content.some(
          (b) => b.type === 'tool_result' && typeof b.content === 'string' && b.content.startsWith('Launching skill:'),
        );
      if (!isAutonomousFlow) {
        const announcement = messages.createTransientMessage(chatId, 'system', [
          { type: 'text', text: `Using skill: ${entry.displayName}` },
        ]);
        messages.append(chatId, announcement);
        emitEvent({ type: 'message.added', chatId, message: announcement });
      }

      if (db.chats.addSkillFile(chatId, entry)) {
        emitEvent({ type: 'context.updated', chatId });
      }
    },

    onError(error: Error) {
      emitEvent({ type: 'error', chatId, error: error.message });
    },
  };
}
