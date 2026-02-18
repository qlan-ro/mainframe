import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@mainframe/types';

const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_CHATS = 50;

export class MessageCache {
  private cache = new Map<string, ChatMessage[]>();

  get(chatId: string): ChatMessage[] | undefined {
    return this.cache.get(chatId);
  }

  set(chatId: string, messages: ChatMessage[]): void {
    this.cache.set(chatId, messages.slice(-MAX_MESSAGES_PER_CHAT));
    this.evictIfNeeded();
  }

  delete(chatId: string): void {
    this.cache.delete(chatId);
  }

  append(chatId: string, message: ChatMessage): void {
    const messages = this.cache.get(chatId) || [];
    messages.push(message);
    if (messages.length > MAX_MESSAGES_PER_CHAT) {
      messages.splice(0, messages.length - MAX_MESSAGES_PER_CHAT);
    }
    this.cache.set(chatId, messages);
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.cache.size > MAX_CHATS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  createTransientMessage(
    chatId: string,
    type: ChatMessage['type'],
    content: MessageContent[],
    metadata?: Record<string, unknown>,
  ): ChatMessage {
    return {
      id: nanoid(),
      chatId,
      type,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    };
  }
}
