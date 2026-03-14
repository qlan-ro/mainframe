import type { ChatMessage, ControlRequest } from '@qlan-ro/mainframe-types';

export class PermissionManager {
  private pendingPermissions = new Map<string, ControlRequest[]>();
  private interruptedChats = new Set<string>();

  getPending(chatId: string): ControlRequest | null {
    return this.pendingPermissions.get(chatId)?.[0] ?? null;
  }

  hasPending(chatId: string): boolean {
    const queue = this.pendingPermissions.get(chatId);
    return queue !== undefined && queue.length > 0;
  }

  matchesPending(chatId: string, requestId: string): boolean {
    const front = this.pendingPermissions.get(chatId)?.[0];
    return front !== undefined && front.requestId === requestId;
  }

  clear(chatId: string): void {
    this.pendingPermissions.delete(chatId);
    this.interruptedChats.delete(chatId);
  }

  enqueue(chatId: string, request: ControlRequest): boolean {
    const queue = this.pendingPermissions.get(chatId) || [];
    queue.push(request);
    this.pendingPermissions.set(chatId, queue);
    return queue.length === 1;
  }

  shift(chatId: string): ControlRequest | undefined {
    const queue = this.pendingPermissions.get(chatId) || [];
    queue.shift();
    if (queue.length === 0) {
      this.pendingPermissions.delete(chatId);
      return undefined;
    }
    return queue[0];
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
