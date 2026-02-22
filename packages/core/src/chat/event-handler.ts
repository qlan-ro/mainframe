import type { DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { BaseAdapter } from '../adapters/base.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';
import { ClaudeEventHandler } from './claude-event-handler.js';

export interface ChatLookup {
  getActiveChat(chatId: string): ActiveChat | undefined;
  getChatIdForProcess(processId: string): string | undefined;
  deleteProcessMapping(processId: string): void;
}

export interface AdapterEventHandler {
  setup(adapter: BaseAdapter): void;
}

export class EventHandler {
  private handlers = new Map<string, AdapterEventHandler>();

  constructor(
    private lookup: ChatLookup,
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private emitEvent: (event: DaemonEvent) => void,
  ) {
    this.handlers.set('claude', new ClaudeEventHandler('claude', lookup, db, messages, permissions, emitEvent));
  }

  setup(): void {
    for (const adapter of this.adapters.all()) {
      const handler = this.handlers.get(adapter.id);
      if (handler) handler.setup(adapter as BaseAdapter);
    }
  }
}
