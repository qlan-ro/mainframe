import { describe, it, expect, vi } from 'vitest';
import {
  extractMentionsFromText,
  trackFileActivity,
  extractPlanFilePathFromText,
  extractLatestPlanFileFromMessages,
} from '../chat/context-tracker.js';
import type { ChatMessage, MessageContent } from '@mainframe/types';

function makeDb(addMentionReturn = true, addModifiedFileReturn = true) {
  return {
    chats: {
      addMention: vi.fn().mockReturnValue(addMentionReturn),
      addModifiedFile: vi.fn().mockReturnValue(addModifiedFileReturn),
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

describe('trackFileActivity', () => {
  it('tracks Write tool_use with relative path', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: 'src/main.ts' } },
    ];
    const changed = trackFileActivity('chat-1', content, db as any, '/project');
    expect(changed).toBe(true);
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'src/main.ts');
  });

  it('tracks Edit tool_use', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: 'lib/utils.ts' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'lib/utils.ts');
  });

  it('converts absolute path to relative', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Write',
        input: { file_path: '/project/src/index.ts' },
      },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'src/index.ts');
  });

  it('skips paths that escape the project (../outside.ts)', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/etc/passwd' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
  });

  it('ignores non-Write/Edit tool blocks', () => {
    const db = makeDb();
    const content: MessageContent[] = [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
  });

  it('ignores non-tool_use blocks', () => {
    const db = makeDb();
    const content: MessageContent[] = [{ type: 'text', text: 'hello' }];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
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
