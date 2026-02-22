import type { DaemonEvent, AdapterSession } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';

export class EventHandler {
  constructor(
    private db: DatabaseManager,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private getActiveChat: (chatId: string) => ActiveChat | undefined,
    private emitEvent: (event: DaemonEvent) => void,
  ) {}

  attachSession(chatId: string, session: AdapterSession): void {
    attachClaudeSessionListeners(
      chatId,
      session,
      this.db,
      this.messages,
      this.permissions,
      this.getActiveChat,
      this.emitEvent,
    );
  }
}

import { trackFileActivity } from './context-tracker.js';
import { createChildLogger } from '../logger.js';
import type { MessageMetadata } from '../adapters/base-session.js';

const log = createChildLogger('event-handler');

function attachClaudeSessionListeners(
  chatId: string,
  session: AdapterSession,
  db: DatabaseManager,
  messages: MessageCache,
  permissions: PermissionManager,
  getActiveChat: (chatId: string) => ActiveChat | undefined,
  emitEvent: (event: DaemonEvent) => void,
): void {
  session.on('init', (claudeSessionId: string) => {
    const active = getActiveChat(chatId);
    if (!active) return;
    db.chats.update(chatId, { claudeSessionId });
    active.chat.claudeSessionId = claudeSessionId;
    emitEvent({ type: 'process.ready', processId: session.id, claudeSessionId });
  });

  session.on('message', (content: any[], metadata?: MessageMetadata) => {
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
      adapterId: session.adapterId,
      ...(metadata ? { model: metadata.model, usage: metadata.usage } : {}),
    };
    const message = messages.createTransientMessage(chatId, 'assistant', content, msgMeta);
    messages.append(chatId, message);
    emitEvent({ type: 'message.added', chatId, message });
  });

  session.on('tool_result', (content: any[]) => {
    const message = messages.createTransientMessage(chatId, 'tool_result', content);
    messages.append(chatId, message);
    emitEvent({ type: 'message.added', chatId, message });
  });

  session.on('permission', (request: any) => {
    const active = getActiveChat(chatId);
    const mode = active?.chat.permissionMode;

    // Interactive tools require real user input even in yolo mode.
    const requiresUserInput = request.toolName === 'AskUserQuestion' || request.toolName === 'ExitPlanMode';
    if (mode === 'yolo' && !requiresUserInput) {
      session.respondToPermission({
        requestId: request.requestId,
        toolUseId: request.toolUseId,
        behavior: 'allow',
        updatedInput: request.input,
      });
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
  });

  session.on('result', (data: any) => {
    const active = getActiveChat(chatId);
    if (!active) return;

    const newCost = active.chat.totalCost + data.cost;
    const newInput = active.chat.totalTokensInput + data.tokensInput;
    const newOutput = active.chat.totalTokensOutput + data.tokensOutput;

    db.chats.update(chatId, {
      totalCost: newCost,
      totalTokensInput: newInput,
      totalTokensOutput: newOutput,
      lastContextTokensInput: data.tokensInput,
      processState: 'idle',
    });
    active.chat.totalCost = newCost;
    active.chat.totalTokensInput = newInput;
    active.chat.totalTokensOutput = newOutput;
    active.chat.lastContextTokensInput = data.tokensInput;
    active.chat.processState = 'idle';
    emitEvent({ type: 'chat.updated', chat: active.chat });

    if (Number.isFinite(data.durationMs)) {
      const turnMeta = messages.createTransientMessage(chatId, 'system', [], {
        internal: true,
        turnDurationMs: data.durationMs,
      });
      messages.append(chatId, turnMeta);
      emitEvent({ type: 'message.added', chatId, message: turnMeta });
    }

    if (data.subtype === 'error_during_execution' && data.isError !== false) {
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
  });

  session.on('exit', (_code: number | null) => {
    log.debug({ sessionId: session.id, chatId }, 'session exited');
    const active = getActiveChat(chatId);
    if (active) {
      active.chat.processState = null;
      db.chats.update(chatId, { processState: null });
    }
    emitEvent({ type: 'process.stopped', processId: session.id });
  });

  session.on('compact', () => {
    const message = messages.createTransientMessage(chatId, 'system', [{ type: 'text', text: 'Context compacted' }]);
    messages.append(chatId, message);
    emitEvent({ type: 'message.added', chatId, message });
  });

  session.on('plan_file', (filePath: string) => {
    if (db.chats.addPlanFile(chatId, filePath)) {
      emitEvent({ type: 'context.updated', chatId });
    }
  });

  session.on('skill_file', (filePath: string) => {
    const segments = filePath.split('/');
    const file = segments.pop() ?? filePath;
    const displayName = file === 'SKILL.md' && segments.length > 0 ? segments.pop()! : file;

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
        { type: 'text', text: `Using skill: ${displayName}` },
      ]);
      messages.append(chatId, announcement);
      emitEvent({ type: 'message.added', chatId, message: announcement });
    }

    if (db.chats.addSkillFile(chatId, { path: filePath, displayName })) {
      emitEvent({ type: 'context.updated', chatId });
    }
  });

  session.on('error', (error: Error) => {
    emitEvent({ type: 'error', chatId, error: error.message });
  });
}
