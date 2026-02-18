import type {
  Chat,
  ChatMessage,
  PermissionRequest,
  PermissionResponse,
  DaemonEvent,
  AdapterProcess,
} from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';

export class PermissionManager {
  private pendingPermissions = new Map<string, PermissionRequest[]>();
  private planExecutionModes = new Map<string, Chat['permissionMode']>();
  private interruptedChats = new Set<string>();

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
  ) {}

  getPending(chatId: string): PermissionRequest | null {
    const chat = this.db.chats.get(chatId);
    if (chat?.permissionMode === 'yolo') return null;
    return this.pendingPermissions.get(chatId)?.[0] ?? null;
  }

  hasPending(chatId: string): boolean {
    const queue = this.pendingPermissions.get(chatId);
    return queue !== undefined && queue.length > 0;
  }

  clear(chatId: string): void {
    this.pendingPermissions.delete(chatId);
  }

  enqueue(chatId: string, request: PermissionRequest): boolean {
    const queue = this.pendingPermissions.get(chatId) || [];
    queue.push(request);
    this.pendingPermissions.set(chatId, queue);
    return queue.length === 1;
  }

  shift(chatId: string): PermissionRequest | undefined {
    const queue = this.pendingPermissions.get(chatId) || [];
    queue.shift();
    if (queue.length === 0) {
      this.pendingPermissions.delete(chatId);
      return undefined;
    }
    return queue[0];
  }

  setPlanExecutionMode(chatId: string, mode: Chat['permissionMode']): void {
    this.planExecutionModes.set(chatId, mode);
  }

  getPlanExecutionMode(chatId: string): Chat['permissionMode'] | undefined {
    return this.planExecutionModes.get(chatId);
  }

  deletePlanExecutionMode(chatId: string): void {
    this.planExecutionModes.delete(chatId);
  }

  markInterrupted(chatId: string): void {
    this.interruptedChats.add(chatId);
  }

  clearInterrupted(chatId: string): boolean {
    return this.interruptedChats.delete(chatId);
  }

  restorePendingPermission(chatId: string, messages: ChatMessage[]): void {
    if (this.hasPending(chatId)) return;

    const answeredToolUseIds = new Set<string>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const hasUserText = msg.type === 'user' && msg.content.some((b) => b.type === 'text');

      if (hasUserText) return;

      if (msg.type === 'assistant' && !msg.content.some((b) => b.type === 'tool_use')) {
        return;
      }

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const isPermissionFailure = block.isError && block.content.includes('permission request failed');
          if (!isPermissionFailure) {
            answeredToolUseIds.add(block.toolUseId);
          }
        }

        if (block.type === 'tool_use') {
          if (!answeredToolUseIds.has(block.id)) {
            this.pendingPermissions.set(chatId, [
              {
                requestId: '',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input,
                suggestions: [],
              },
            ]);
          }
          return;
        }
      }
    }
  }
}
