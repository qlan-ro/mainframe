import type { Chat, ControlResponse, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { PermissionManager } from './permission-manager.js';
import type { MessageCache } from './message-cache.js';
import type { ActiveChat } from './types.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { PlanModeActionHandler, PlanActionContext } from './plan-mode-actions.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('chat:plan-mode');

export interface PlanModeContext {
  messages: MessageCache;
  db: DatabaseManager;
  permissions: PermissionManager;
  adapters: AdapterRegistry;
  getActiveChat(chatId: string): ActiveChat | undefined;
  emitEvent(event: DaemonEvent): void;
  clearDisplayCache(chatId: string): void;
  startChat(chatId: string): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

/**
 * Adapter-agnostic dispatcher for plan-mode actions.
 *
 * Runtime behavior is delegated to the adapter's `createPlanModeHandler()`
 * factory (see `PlanModeActionHandler`). The dispatcher only preserves the
 * direct no-process permissionMode/planMode update — there is no live session
 * to act on at that point so the adapter handler has nothing to run.
 */
export class PlanModeHandler {
  constructor(private ctx: PlanModeContext) {}

  /**
   * No active session path. Persist the chosen execution mode and clear
   * planMode so a follow-up spawn starts out of plan. The adapter handler is
   * intentionally NOT invoked here — there is no session for it to manipulate.
   */
  async handleNoProcess(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const exec = (response.executionMode ?? 'default') as NonNullable<Chat['permissionMode']>;
    if (exec !== active.chat.permissionMode || active.chat.planMode) {
      active.chat.permissionMode = exec;
      active.chat.planMode = false;
      this.ctx.db.chats.update(chatId, { permissionMode: exec, planMode: false });
      this.ctx.emitEvent({ type: 'chat.updated', chat: active.chat });
    }
  }

  /** User approved AND asked to clear context. Delegates to the adapter handler. */
  async handleClearContext(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const handler = this.resolveHandler(active.chat.adapterId);
    if (!handler) {
      log.warn({ chatId, adapterId: active.chat.adapterId }, 'no plan-mode handler for adapter');
      return;
    }
    await handler.onApproveAndClearContext(response, this.buildActionContext(chatId, active));
  }

  /** User approved without clearing context. Delegates to the adapter handler. */
  async handleEscalation(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const handler = this.resolveHandler(active.chat.adapterId);
    if (!handler) {
      log.warn({ chatId, adapterId: active.chat.adapterId }, 'no plan-mode handler for adapter');
      return;
    }
    await handler.onApprove(response, this.buildActionContext(chatId, active));
  }

  private resolveHandler(adapterId: string): PlanModeActionHandler | null {
    const adapter = this.ctx.adapters.get(adapterId);
    if (!adapter?.createPlanModeHandler) return null;
    return adapter.createPlanModeHandler() as PlanModeActionHandler;
  }

  private buildActionContext(chatId: string, active: ActiveChat): PlanActionContext {
    return {
      chatId,
      active,
      chat: active.chat,
      db: this.ctx.db,
      messages: this.ctx.messages,
      permissions: this.ctx.permissions,
      emitEvent: this.ctx.emitEvent,
      clearDisplayCache: this.ctx.clearDisplayCache,
      startChat: this.ctx.startChat,
      sendMessage: this.ctx.sendMessage,
    };
  }
}
