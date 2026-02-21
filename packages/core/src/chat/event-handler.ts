import type { DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/index.js';
import type { MessageMetadata } from '../adapters/base.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';
import { trackFileActivity } from './context-tracker.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('event-handler');

export interface ChatLookup {
  getActiveChat(chatId: string): ActiveChat | undefined;
  getChatIdForProcess(processId: string): string | undefined;
  deleteProcessMapping(processId: string): void;
}

export class EventHandler {
  constructor(
    private lookup: ChatLookup,
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private emitEvent: (event: DaemonEvent) => void,
  ) {}

  setup(): void {
    const claude = this.adapters.get('claude') as ClaudeAdapter;
    if (!claude) return;

    claude.on('init', (processId, claudeSessionId) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const active = this.lookup.getActiveChat(chatId);
      if (!active) return;
      this.db.chats.update(chatId, { claudeSessionId });
      active.chat.claudeSessionId = claudeSessionId;
      this.emitEvent({ type: 'process.ready', processId, claudeSessionId });
    });

    claude.on('message', (processId, content, metadata?: MessageMetadata) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      log.debug({ chatId, blockCount: content.length }, 'assistant message received');
      if (trackFileActivity(chatId, content, this.db, undefined)) {
        this.emitEvent({ type: 'context.updated', chatId });
      }
      const hasEnterPlanMode = content.some((b) => b.type === 'tool_use' && b.name === 'EnterPlanMode');
      if (hasEnterPlanMode) {
        const active = this.lookup.getActiveChat(chatId);
        if (active && active.chat.permissionMode !== 'plan') {
          this.db.chats.update(chatId, { permissionMode: 'plan' });
          active.chat.permissionMode = 'plan';
          this.emitEvent({ type: 'chat.updated', chat: active.chat });
        }
      }
      const msgMeta: Record<string, unknown> | undefined = metadata
        ? { model: metadata.model, usage: metadata.usage }
        : undefined;
      const message = this.messages.createTransientMessage(chatId, 'assistant', content, msgMeta);
      this.messages.append(chatId, message);
      this.emitEvent({ type: 'message.added', chatId, message });
    });

    claude.on('tool_result', (processId, content) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const message = this.messages.createTransientMessage(chatId, 'tool_result', content);
      this.messages.append(chatId, message);
      this.emitEvent({ type: 'message.added', chatId, message });
    });

    claude.on('permission', (processId, request) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const active = this.lookup.getActiveChat(chatId);
      const mode = active?.chat.permissionMode;

      // Interactive tools require real user input even in yolo mode.
      const requiresUserInput = request.toolName === 'AskUserQuestion' || request.toolName === 'ExitPlanMode';
      if (mode === 'yolo' && active?.process && !requiresUserInput) {
        claude.respondToPermission(active.process, {
          requestId: request.requestId,
          toolUseId: request.toolUseId,
          behavior: 'allow',
          updatedInput: request.input,
        });
        return;
      }

      const isFirst = this.permissions.enqueue(chatId, request);
      if (isFirst) {
        log.info(
          { chatId, requestId: request.requestId, toolName: request.toolName },
          'permission.requested emitted to clients',
        );
        this.emitEvent({ type: 'permission.requested', chatId, request });
      } else {
        log.info(
          { chatId, requestId: request.requestId, toolName: request.toolName },
          'permission queued (another already pending)',
        );
      }
    });

    claude.on('result', (processId, data) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const active = this.lookup.getActiveChat(chatId);
      if (!active) return;

      const newCost = active.chat.totalCost + data.cost;
      const newInput = active.chat.totalTokensInput + data.tokensInput;
      const newOutput = active.chat.totalTokensOutput + data.tokensOutput;

      this.db.chats.update(chatId, {
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
      this.emitEvent({ type: 'chat.updated', chat: active.chat });

      if (Number.isFinite(data.durationMs)) {
        const turnMeta = this.messages.createTransientMessage(chatId, 'system', [], {
          internal: true,
          turnDurationMs: data.durationMs,
        });
        this.messages.append(chatId, turnMeta);
        this.emitEvent({ type: 'message.added', chatId, message: turnMeta });
      }

      if (data.subtype === 'error_during_execution' && data.isError !== false) {
        const wasInterrupted = this.permissions.clearInterrupted(chatId);
        if (!wasInterrupted) {
          const message = this.messages.createTransientMessage(chatId, 'error', [
            { type: 'error', message: 'Session ended unexpectedly' },
          ]);
          this.messages.append(chatId, message);
          this.emitEvent({ type: 'message.added', chatId, message });
        }
      } else {
        this.permissions.clearInterrupted(chatId);
      }
    });

    claude.on('exit', (processId, _code) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      log.debug({ processId, chatId }, 'process exited');
      const active = this.lookup.getActiveChat(chatId);
      if (active) {
        active.process = null;
        active.chat.processState = null;
        this.db.chats.update(chatId, { processState: null });
      }
      this.lookup.deleteProcessMapping(processId);
      this.emitEvent({ type: 'process.stopped', processId });
    });

    claude.on('compact', (processId) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const message = this.messages.createTransientMessage(chatId, 'system', [
        { type: 'text', text: 'Context compacted' },
      ]);
      this.messages.append(chatId, message);
      this.emitEvent({ type: 'message.added', chatId, message });
    });

    claude.on('plan_file', (processId, filePath) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      if (this.db.chats.addPlanFile(chatId, filePath)) {
        this.emitEvent({ type: 'context.updated', chatId });
      }
    });

    claude.on('skill_file', (processId, filePath) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      if (!chatId) return;
      const segments = filePath.split('/');
      const file = segments.pop() ?? filePath;
      const displayName = file === 'SKILL.md' && segments.length > 0 ? segments.pop()! : file;

      // Autonomous Skill-tool flows emit a tool_result containing "Launching skill:" before
      // the isMeta skill content arrives. Slash-command flows do not, so we add an
      // announcement message to confirm the skill was loaded.
      const cachedMessages = this.messages.get(chatId) ?? [];
      const lastMsg = cachedMessages[cachedMessages.length - 1];
      const isAutonomousFlow =
        lastMsg?.type === 'tool_result' &&
        lastMsg.content.some(
          (b) => b.type === 'tool_result' && typeof b.content === 'string' && b.content.startsWith('Launching skill:'),
        );
      if (!isAutonomousFlow) {
        const announcement = this.messages.createTransientMessage(chatId, 'system', [
          { type: 'text', text: `Using skill: ${displayName}` },
        ]);
        this.messages.append(chatId, announcement);
        this.emitEvent({ type: 'message.added', chatId, message: announcement });
      }

      if (this.db.chats.addSkillFile(chatId, { path: filePath, displayName })) {
        this.emitEvent({ type: 'context.updated', chatId });
      }
    });

    claude.on('error', (processId, error) => {
      const chatId = this.lookup.getChatIdForProcess(processId);
      this.emitEvent({ type: 'error', chatId, error: error.message });
    });
  }
}
