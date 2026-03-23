import { describe, it, expect, vi } from 'vitest';
import {
  extractMentionsFromText,
  extractPlanFilePathFromText,
  extractLatestPlanFileFromMessages,
} from '../chat/context-tracker.js';
import type { ChatMessage } from '@qlan-ro/mainframe-types';

function makeDb(addMentionReturn = true) {
  return {
    chats: {
      addMention: vi.fn().mockReturnValue(addMentionReturn),
      get: vi.fn().mockReturnValue({ projectId: 'proj-1' }),
    },
    projects: {
      get: vi.fn().mockReturnValue({ id: 'proj-1', path: '/project' }),
    },
  };
}

describe('extractMentionsFromText', () => {
  it('extracts file mentions with path separators', () => {
    const db = makeDb();
    const changed = extractMentionsFromText('chat-1', 'Please update @src/utils.ts', db as any);
    expect(changed).toBe(true);
    expect(db.chats.addMention).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        path: 'src/utils.ts',
        kind: 'file',
      }),
    );
  });

  it('extracts file mentions with dots (file.ext)', () => {
    const db = makeDb();
    extractMentionsFromText('chat-1', 'Look at @README.md', db as any);
    expect(db.chats.addMention).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        path: 'README.md',
      }),
    );
  });

  it('skips bare @words without slash or dot', () => {
    const db = makeDb();
    const changed = extractMentionsFromText('chat-1', 'hello @user goodbye', db as any);
    expect(changed).toBe(false);
    expect(db.chats.addMention).not.toHaveBeenCalled();
  });

  it('strips trailing comma/semicolon punctuation from mention', () => {
    const db = makeDb();
    extractMentionsFromText('chat-1', 'See @src/file.ts,', db as any);
    expect(db.chats.addMention).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        path: 'src/file.ts',
      }),
    );
  });

  it('returns false when db.addMention returns false (duplicate)', () => {
    const db = makeDb(false);
    const changed = extractMentionsFromText('chat-1', '@src/file.ts', db as any);
    expect(changed).toBe(false);
  });
});

describe('extractPlanFilePathFromText', () => {
  it('extracts "saved to:" pattern', () => {
    const text = 'Your plan has been saved to: /docs/plans/2026-01-01-feature.md';
    expect(extractPlanFilePathFromText(text)).toBe('/docs/plans/2026-01-01-feature.md');
  });

  it('extracts generic markdown path', () => {
    const text = 'See the plan at `/docs/plans/feature.md` for details.';
    expect(extractPlanFilePathFromText(text)).toBe('/docs/plans/feature.md');
  });

  it('returns null when no plan path present', () => {
    expect(extractPlanFilePathFromText('No plan here.')).toBeNull();
  });
});

describe('extractLatestPlanFileFromMessages', () => {
  function makeMsg(text: string): ChatMessage {
    return {
      id: 'm1',
      chatId: 'c1',
      type: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: new Date().toISOString(),
    };
  }

  it('returns path from latest message containing a plan path', () => {
    const messages = [makeMsg('No plan here.'), makeMsg('Your plan has been saved to: /docs/plans/feature.md')];
    expect(extractLatestPlanFileFromMessages(messages)).toBe('/docs/plans/feature.md');
  });

  it('returns null when no message has a plan path', () => {
    expect(extractLatestPlanFileFromMessages([makeMsg('hello')])).toBeNull();
  });

  it('prefers the most recent message', () => {
    const messages = [
      makeMsg('Your plan has been saved to: /docs/plans/old.md'),
      makeMsg('Your plan has been saved to: /docs/plans/new.md'),
    ];
    expect(extractLatestPlanFileFromMessages(messages)).toBe('/docs/plans/new.md');
  });
});
