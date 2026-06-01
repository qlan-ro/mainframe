import { describe, it, expect } from 'vitest';
import { ClientEventSchema } from '../ws-schemas.js';

describe('ClientEventSchema', () => {
  // Kept types — should parse successfully
  it('parses message.send', () => {
    const result = ClientEventSchema.safeParse({ type: 'message.send', chatId: 'c1', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('parses permission.respond', () => {
    const result = ClientEventSchema.safeParse({
      type: 'permission.respond',
      chatId: 'c1',
      response: {
        requestId: 'r1',
        toolUseId: 'tu1',
        behavior: 'allow',
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses subscribe', () => {
    const result = ClientEventSchema.safeParse({ type: 'subscribe', chatId: 'c1' });
    expect(result.success).toBe(true);
  });

  it('parses unsubscribe', () => {
    const result = ClientEventSchema.safeParse({ type: 'unsubscribe', chatId: 'c1' });
    expect(result.success).toBe(true);
  });

  it('parses subscribe:file', () => {
    const result = ClientEventSchema.safeParse({ type: 'subscribe:file', path: '/some/file.ts' });
    expect(result.success).toBe(true);
  });

  it('parses unsubscribe:file', () => {
    const result = ClientEventSchema.safeParse({ type: 'unsubscribe:file', path: '/some/file.ts' });
    expect(result.success).toBe(true);
  });

  // Removed types — should fail safeParse
  it('rejects chat.create (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({
      type: 'chat.create',
      projectId: 'p1',
      adapterId: 'claude',
    });
    expect(result.success).toBe(false);
  });

  it('rejects chat.resume (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({ type: 'chat.resume', chatId: 'c1' });
    expect(result.success).toBe(false);
  });

  it('rejects chat.end (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({ type: 'chat.end', chatId: 'c1' });
    expect(result.success).toBe(false);
  });

  it('rejects chat.interrupt (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({ type: 'chat.interrupt', chatId: 'c1' });
    expect(result.success).toBe(false);
  });

  it('rejects chat.updateConfig (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({ type: 'chat.updateConfig', chatId: 'c1' });
    expect(result.success).toBe(false);
  });

  it('rejects message.queue.edit (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({
      type: 'message.queue.edit',
      chatId: 'c1',
      messageId: 'm1',
      content: 'new',
    });
    expect(result.success).toBe(false);
  });

  it('rejects message.queue.cancel (migrated to REST)', () => {
    const result = ClientEventSchema.safeParse({
      type: 'message.queue.cancel',
      chatId: 'c1',
      messageId: 'm1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown types', () => {
    const result = ClientEventSchema.safeParse({ type: 'totally.unknown', chatId: 'c1' });
    expect(result.success).toBe(false);
  });
});
