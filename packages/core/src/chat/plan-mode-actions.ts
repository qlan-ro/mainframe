import type { Chat, ControlResponse, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from './types.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { DatabaseManager } from '../db/index.js';

export interface PlanActionContext {
  chatId: string;
  active: ActiveChat;
  chat: Chat;
  db: DatabaseManager;
  messages: MessageCache;
  permissions: PermissionManager;
  emitEvent(event: DaemonEvent): void;
  clearDisplayCache(chatId: string): void;
  startChat(chatId: string): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

export interface PlanModeActionHandler {
  /**
   * User approved the plan WITHOUT clearing context. Default behavior for
   * most adapters is to set planMode=false and apply the chosen exec mode.
   */
  onApprove(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User approved AND checked "Clear Context". Adapter decides how to reset
   * (Claude: kill & respawn with same session id; Codex: thread/start new thread).
   */
  onApproveAndClearContext(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User rejected the plan. Adapter translates this to the appropriate
   * per-protocol "stay in plan" response.
   */
  onReject(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User provided revision feedback. Adapter forwards as free-form text.
   */
  onRevise(feedback: string, response: ControlResponse, context: PlanActionContext): Promise<void>;
}
