import { describe, it, expect } from 'vitest';
import { ClientEventSchema } from '../server/ws-schemas.js';

describe('MessageSend schema', () => {
  const base = {
    type: 'message.send' as const,
    chatId: 'chat-1',
  };

  it('accepts non-empty content with no attachments', () => {
    const result = ClientEventSchema.safeParse({ ...base, content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts non-empty content with attachments', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      content: 'hello',
      attachmentIds: ['att-1'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty content when attachmentIds are present', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      content: '',
      attachmentIds: ['att-1'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content with no attachments', () => {
    const result = ClientEventSchema.safeParse({ ...base, content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty content with empty attachmentIds array', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      content: '',
      attachmentIds: [],
    });
    expect(result.success).toBe(false);
  });
});
