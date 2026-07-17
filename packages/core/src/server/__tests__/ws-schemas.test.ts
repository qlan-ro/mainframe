import { describe, it, expect } from 'vitest';
import { ClientEventSchema } from '../ws-schemas.js';

describe('ClientEventSchema', () => {
  it.each([
    ['message.send', { type: 'message.send', chatId: 'c1', content: 'hello' }],
    [
      'permission.respond',
      {
        type: 'permission.respond',
        chatId: 'c1',
        response: { requestId: 'r1', toolUseId: 'tu1', behavior: 'allow' },
      },
    ],
    ['subscribe', { type: 'subscribe', chatId: 'c1' }],
    ['unsubscribe', { type: 'unsubscribe', chatId: 'c1' }],
    ['subscribe:file with absolute path (no context)', { type: 'subscribe:file', path: '/some/file.ts' }],
    [
      'subscribe:file with relative path + projectId + chatId',
      { type: 'subscribe:file', path: 'packages/core/src/server/websocket.ts', projectId: 'proj-1', chatId: 'chat-1' },
    ],
    [
      'subscribe:file with relative path + projectId (no chatId)',
      { type: 'subscribe:file', path: 'src/index.ts', projectId: 'proj-1' },
    ],
    ['unsubscribe:file with absolute path (no context)', { type: 'unsubscribe:file', path: '/some/file.ts' }],
    [
      'unsubscribe:file with relative path + projectId + chatId',
      { type: 'unsubscribe:file', path: 'src/index.ts', projectId: 'proj-1', chatId: 'chat-1' },
    ],
  ])('parses %s', (_label, event) => {
    const result = ClientEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    // The parsed value must round-trip the input, not just validate it.
    if (result.success) expect(result.data).toEqual(event);
  });

  it.each([
    ['chat.create (migrated to REST)', { type: 'chat.create', projectId: 'p1', adapterId: 'claude' }],
    ['chat.resume (migrated to REST)', { type: 'chat.resume', chatId: 'c1' }],
    ['chat.end (migrated to REST)', { type: 'chat.end', chatId: 'c1' }],
    ['chat.interrupt (migrated to REST)', { type: 'chat.interrupt', chatId: 'c1' }],
    ['chat.updateConfig (migrated to REST)', { type: 'chat.updateConfig', chatId: 'c1' }],
    [
      'message.queue.edit (migrated to REST)',
      { type: 'message.queue.edit', chatId: 'c1', messageId: 'm1', content: 'new' },
    ],
    ['message.queue.cancel (migrated to REST)', { type: 'message.queue.cancel', chatId: 'c1', messageId: 'm1' }],
    ['unknown types', { type: 'totally.unknown', chatId: 'c1' }],
  ])('rejects %s', (_label, event) => {
    expect(ClientEventSchema.safeParse(event).success).toBe(false);
  });
});
