import { describe, it, expect } from 'vitest';
import { MessageCache } from '../chat/message-cache.js';

describe('MessageCache', () => {
  it('append creates array if not exists', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'user', [{ type: 'text', text: 'hi' }]);
    cache.append('c1', msg);
    expect(cache.get('c1')).toHaveLength(1);
  });

  it('set and get work', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'user', [{ type: 'text', text: 'test' }]);
    cache.set('c1', [msg]);
    expect(cache.get('c1')?.[0].content[0]).toEqual({ type: 'text', text: 'test' });
  });

  it('delete removes chat messages', () => {
    const cache = new MessageCache();
    cache.set('c1', [cache.createTransientMessage('c1', 'user', [])]);
    cache.delete('c1');
    expect(cache.get('c1')).toBeUndefined();
  });

  it('enforces per-chat message limit', () => {
    const cache = new MessageCache();
    for (let i = 0; i < 2100; i++) {
      cache.append('c1', cache.createTransientMessage('c1', 'user', [{ type: 'text', text: `msg-${i}` }]));
    }
    const messages = cache.get('c1');
    expect(messages!.length).toBeLessThanOrEqual(2000);
  });

  it('createTransientMessage produces valid structure', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'assistant', [{ type: 'text', text: 'hello' }], { model: 'test' });
    expect(msg.chatId).toBe('c1');
    expect(msg.type).toBe('assistant');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeDefined();
    expect(msg.metadata).toEqual({ model: 'test' });
  });
});
