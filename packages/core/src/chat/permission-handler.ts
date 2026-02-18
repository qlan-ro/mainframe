import type { Chat, ChatMessage, PermissionRequest, PermissionResponse, DaemonEvent } from '@mainframe/types';
import type { AdapterRegistry } from '../adapters/index.js';
import type { DatabaseManager } from '../db/index.js';
import type { PermissionManager } from './permission-manager.js';
import type { PlanModeHandler } from './plan-mode-handler.js';
import type { MessageCache } from './message-cache.js';
import type { ActiveChat } from './types.js';

export interface PermissionHandlerDeps {
  permissions: PermissionManager;
  planMode: PlanModeHandler;
  messages: MessageCache;
  adapters: AdapterRegistry;
  db: DatabaseManager;
  processToChat: Map<string, string>;
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

    if (!active?.process) {
      return this.handleNoProcessPermission(chatId, response, active);
    }

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

  private async handleNoProcessPermission(
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
    if (started?.process) {
      started.chat.processState = 'working';
      this.deps.db.chats.update(chatId, { processState: 'working' });
      this.deps.emitEvent({ type: 'chat.updated', chat: started.chat });

      const adapter = this.deps.adapters.get(started.chat.adapterId);
      if (adapter) {
        await adapter.respondToPermission(started.process, response);
      }
    }
  }

  private async handleClearContextPermission(
    chatId: string,
    active: ActiveChat,
    response: PermissionResponse,
  ): Promise<void> {
    const processId = active.process!.id;
    await this.deps.planMode.handleClearContext(chatId, active, response);
    this.deps.processToChat.delete(processId);
  }

  private async handleNormalPermission(
    chatId: string,
    active: ActiveChat,
    response: PermissionResponse,
  ): Promise<void> {
    const adapter = this.deps.adapters.get(active.chat.adapterId);
    if (!adapter) throw new Error(`Adapter not found`);

    await adapter.respondToPermission(active.process!, response);

    const nextRequest = this.deps.permissions.shift(chatId);
    if (nextRequest) {
      this.deps.emitEvent({ type: 'permission.requested', chatId, request: nextRequest });
    }

    if (response.behavior === 'allow' && response.toolName === 'ExitPlanMode') {
      await this.deps.planMode.handleEscalation(chatId, active, response);
    }
  }
}
