import { describe, it, expect } from 'vitest';
import { ClientEventSchema, CreateChatBody } from '../server/ws-schemas.js';

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

// chat.create has moved to REST (POST /api/chats). The body schema is now
// CreateChatBody (exported from ws-schemas.ts) without the `type` discriminator.
describe('CreateChatBody REST schema', () => {
  const base = {
    projectId: 'proj-1',
    adapterId: 'claude',
  };

  it('accepts a payload without worktree fields', () => {
    const result = CreateChatBody.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts a payload with both worktreePath and branchName', () => {
    const result = CreateChatBody.safeParse({
      ...base,
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty worktreePath', () => {
    const result = CreateChatBody.safeParse({
      ...base,
      worktreePath: '',
      branchName: 'feat-x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty branchName when provided', () => {
    const result = CreateChatBody.safeParse({
      ...base,
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects worktreePath without branchName', () => {
    const result = CreateChatBody.safeParse({
      ...base,
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects branchName without worktreePath', () => {
    const result = CreateChatBody.safeParse({
      ...base,
      branchName: 'feat-x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects chat.create type via ClientEventSchema (WS type removed)', () => {
    const result = ClientEventSchema.safeParse({ type: 'chat.create', ...base });
    expect(result.success).toBe(false);
  });
});
