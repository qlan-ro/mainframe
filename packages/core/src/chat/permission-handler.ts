import type { Chat, ChatMessage, PermissionRequest, PermissionResponse, DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { PermissionManager } from './permission-manager.js';
import type { PlanModeHandler } from './plan-mode-handler.js';
import type { MessageCache } from './message-cache.js';
import type { ActiveChat } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('permission-handler');

export interface PermissionHandlerDeps {
  permissions: PermissionManager;
  planMode: PlanModeHandler;
  messages: MessageCache;
  db: DatabaseManager;
  getActiveChat: (chatId: string) => ActiveChat | undefined;
  startChat: (chatId: string) => Promise<void>;
  emitEvent: (event: DaemonEvent) => void;
  getChat: (chatId: string) => Chat | null;
  getMessages: (chatId: string) => Promise<ChatMessage[]>;
}

export class ChatPermissionHandler {
  constructor(private deps: PermissionHandlerDeps) {}

  async respondToPermission(chatId: string, response: PermissionResponse): Promise<void> {
    const active = this.deps.getActiveChat(chatId);

    if (!active?.session?.isSpawned) {
      log.warn(
        { chatId, requestId: response.requestId, toolName: response.toolName, behavior: response.behavior },
        'respondToPermission: no active session, will start fresh',
      );
      return this.handleNoSessionPermission(chatId, response, active);
    }

    log.info(
      { chatId, requestId: response.requestId, toolName: response.toolName, behavior: response.behavior },
      'respondToPermission: forwarding to session',
    );

    if (response.message) {
      const message = this.deps.messages.createTransientMessage(chatId, 'user', [
        { type: 'text', text: response.message },
      ]);
      this.deps.messages.append(chatId, message);
      this.deps.emitEvent({ type: 'message.added', chatId, message });
    }

    if (response.clearContext && response.behavior === 'allow' && response.toolName === 'ExitPlanMode') {
      return this.handleClearContextPermission(chatId, active, response);
    }

    return this.handleNormalPermission(chatId, active, response);
  }

  async getPendingPermission(chatId: string): Promise<PermissionRequest | null> {
    const chat = this.deps.getChat(chatId);
    if (chat?.permissionMode === 'yolo') return null;

    if (!this.deps.permissions.hasPending(chatId)) {
      await this.deps.getMessages(chatId);
    }
    return this.deps.permissions.getPending(chatId);
  }

  hasPendingPermission(chatId: string): boolean {
    return this.deps.permissions.hasPending(chatId);
  }

  clearPendingPermission(chatId: string): void {
    this.deps.permissions.clear(chatId);
  }

  private async handleNoSessionPermission(
    chatId: string,
    response: PermissionResponse,
    active: ActiveChat | undefined,
  ): Promise<void> {
    this.deps.permissions.clear(chatId);

    if (response.behavior === 'allow' && response.toolName === 'ExitPlanMode' && active) {
      await this.deps.planMode.handleNoProcess(chatId, active, response);
    }

    await this.deps.startChat(chatId);

    const started = this.deps.getActiveChat(chatId);
    if (started?.session?.isSpawned) {
      started.chat.processState = 'working';
      this.deps.db.chats.update(chatId, { processState: 'working' });
      this.deps.emitEvent({ type: 'chat.updated', chat: started.chat });
      await started.session.respondToPermission(response);
    }
  }

  private async handleClearContextPermission(
    chatId: string,
    active: ActiveChat,
    response: PermissionResponse,
  ): Promise<void> {
    await this.deps.planMode.handleClearContext(chatId, active, response);
  }

  private async handleNormalPermission(
    chatId: string,
    active: ActiveChat,
    response: PermissionResponse,
  ): Promise<void> {
    if (!active.session) throw new Error(`No session for chat ${chatId}`);

    await active.session.respondToPermission(response);

    const nextRequest = this.deps.permissions.shift(chatId);
    if (nextRequest) {
      this.deps.emitEvent({ type: 'permission.requested', chatId, request: nextRequest });
    }

    if (response.behavior === 'allow' && response.toolName === 'ExitPlanMode') {
      await this.deps.planMode.handleEscalation(chatId, active, response);
    }
  }
}
