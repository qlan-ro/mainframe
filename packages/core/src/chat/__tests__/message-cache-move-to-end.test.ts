import { describe, it, expect } from 'vitest';
import { MessageCache } from '../message-cache.js';
import type { ChatMessage } from '@qlan-ro/mainframe-types';

const msg = (id: string): ChatMessage => ({
  id,
  chatId: 'c1',
  type: 'user',
  content: [{ type: 'text', text: id }],
  timestamp: new Date().toISOString(),
});

describe('MessageCache.moveToEnd', () => {
  it('moves a message to the end and preserves the others in order', () => {
    const cache = new MessageCache();
    cache.append('c1', msg('a'));
    cache.append('c1', msg('b'));
    cache.append('c1', msg('c'));
    expect(cache.moveToEnd('c1', 'a')).toBe(true);
    expect(cache.get('c1')!.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns false for an unknown chat or message', () => {
    const cache = new MessageCache();
    cache.append('c1', msg('a'));
    expect(cache.moveToEnd('c1', 'missing')).toBe(false);
    expect(cache.moveToEnd('nope', 'a')).toBe(false);
  });

  it('keeps order when the message is already last', () => {
    const cache = new MessageCache();
    cache.append('c1', msg('a'));
    cache.append('c1', msg('b'));
    expect(cache.moveToEnd('c1', 'b')).toBe(true);
    expect(cache.get('c1')!.map((m) => m.id)).toEqual(['a', 'b']);
  });
});
