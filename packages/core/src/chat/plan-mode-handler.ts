import type { Chat, PermissionResponse, DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { PermissionManager } from './permission-manager.js';
import type { MessageCache } from './message-cache.js';
import type { ActiveChat } from './types.js';
import { extractLatestPlanFileFromMessages } from './context-tracker.js';

export interface PlanModeContext {
  permissions: PermissionManager;
  messages: MessageCache;
  db: DatabaseManager;
  getActiveChat(chatId: string): ActiveChat | undefined;
  emitEvent(event: DaemonEvent): void;
  startChat(chatId: string): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

export class PlanModeHandler {
  constructor(private ctx: PlanModeContext) {}

  async handleNoProcess(chatId: string, active: ActiveChat, response: PermissionResponse): Promise<void> {
    const targetMode = (response.executionMode ?? this.ctx.permissions.getPlanExecutionMode(chatId)) as
      | Chat['permissionMode']
      | undefined;
    this.ctx.permissions.deletePlanExecutionMode(chatId);
    const newMode = targetMode || 'default';
    if (newMode !== active.chat.permissionMode) {
      active.chat.permissionMode = newMode;
      this.ctx.db.chats.update(chatId, { permissionMode: newMode });
      this.ctx.emitEvent({ type: 'chat.updated', chat: active.chat });
    }
  }

  async handleClearContext(chatId: string, active: ActiveChat, response: PermissionResponse): Promise<void> {
    const plan = (response.updatedInput as Record<string, unknown> | undefined)?.plan as string | undefined;
    const recoveredPlanPath = extractLatestPlanFileFromMessages(this.ctx.messages.get(chatId) ?? []);
    if (recoveredPlanPath && this.ctx.db.chats.addPlanFile(chatId, recoveredPlanPath)) {
      this.ctx.emitEvent({ type: 'context.updated', chatId });
    }
    const targetMode = (response.executionMode ?? this.ctx.permissions.getPlanExecutionMode(chatId)) as
      | Chat['permissionMode']
      | undefined;
    this.ctx.permissions.deletePlanExecutionMode(chatId);
    const newMode = targetMode || 'default';

    if (!active.session?.isSpawned) {
      this.ctx.permissions.shift(chatId);
    } else {
      await active.session.respondToPermission({
        ...response,
        behavior: 'deny',
        message: 'User chose to clear context and start a new session.',
      });

      this.ctx.permissions.shift(chatId);

      await active.session.kill();
      active.session.removeAllListeners();
      active.session = null;
    }

    active.chat.claudeSessionId = undefined;
    active.chat.permissionMode = newMode;
    this.ctx.db.chats.update(chatId, { claudeSessionId: undefined, permissionMode: newMode });
    this.ctx.emitEvent({ type: 'chat.updated', chat: active.chat });

    this.ctx.messages.set(chatId, []);
    this.ctx.emitEvent({ type: 'messages.cleared', chatId });

    await this.ctx.startChat(chatId);

    if (plan) {
      await this.ctx.sendMessage(chatId, `Implement the following plan:\n\n${plan}`);
    }
  }

  async handleEscalation(chatId: string, active: ActiveChat, response: PermissionResponse): Promise<void> {
    const targetMode = (response.executionMode ?? this.ctx.permissions.getPlanExecutionMode(chatId)) as
      | Chat['permissionMode']
      | undefined;
    this.ctx.permissions.deletePlanExecutionMode(chatId);
    const newMode = targetMode || 'default';
    if (newMode !== active.chat.permissionMode) {
      active.chat.permissionMode = newMode;
      this.ctx.db.chats.update(chatId, { permissionMode: newMode });
      this.ctx.emitEvent({ type: 'chat.updated', chat: active.chat });

      if (active.session?.isSpawned) {
        await active.session.setPermissionMode(newMode);
      }
    }
  }
}
