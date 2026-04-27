import { describe, it, expect, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';

describe('buildSink onExit: session-identity guard', () => {
  it('ignores close from a superseded session', () => {
    const chatId = 'c1';
    const chat: any = { id: chatId, processState: 'working' };
    const activeChat = { chat, session: { id: 'session-new' } };

    const emitted: any[] = [];
    const handler = new EventHandler(
      { chats: { update: vi.fn() } } as any,
      { get: () => [], set: vi.fn() } as any,
      { clear: vi.fn(), clearInterrupted: vi.fn() } as any,
      () => activeChat as any,
      (event) => emitted.push(event),
    );
    const sink = handler.buildSink(chatId, 'session-old', vi.fn());

    sink.onExit(0);

    expect(chat.processState).toBe('working');
    expect(emitted.find((event) => event.type === 'chat.updated')).toBeUndefined();
  });

  it('applies close from the current session', () => {
    const chatId = 'c2';
    const chat: any = { id: chatId, processState: 'working' };
    const activeChat = { chat, session: { id: 'session-a' } };

    const emitted: any[] = [];
    const handler = new EventHandler(
      { chats: { update: vi.fn() } } as any,
      { get: () => [], set: vi.fn() } as any,
      { clear: vi.fn(), clearInterrupted: vi.fn() } as any,
      () => activeChat as any,
      (event) => emitted.push(event),
    );
    const sink = handler.buildSink(chatId, 'session-a', vi.fn());

    sink.onExit(0);

    expect(chat.processState).toBeNull();
    expect(emitted.some((event) => event.type === 'chat.updated')).toBe(true);
  });
});
