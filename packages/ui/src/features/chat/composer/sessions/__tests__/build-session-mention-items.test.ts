/**
 * buildSessionMentionItems — the pure projection from the thread list to the
 * `@` picker's session rows (todo #240). AC 8, 17, 24.
 *
 * Every case states a fixed thread-list/resolution input and a hardcoded
 * expected `items`/`pathByChatId` shape — none of these recompute the
 * function's own filter/sort/disambiguate logic.
 */
import { describe, it, expect } from 'vitest';
import type { TranscriptResolution } from '@qlan-ro/mainframe-types';
import type { SessionItem, SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { buildSessionMentionItems } from '../build-session-mention-items';

const PROJECT = 'proj-1';

function session(overrides: { remoteId: string; title?: string; custom?: Partial<SessionCustom> }): SessionItem {
  return {
    id: overrides.remoteId,
    remoteId: overrides.remoteId,
    title: overrides.title,
    status: 'regular',
    custom: {
      projectId: PROJECT,
      adapterId: 'claude',
      claudeSessionId: 'sess',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      transcriptMissing: false,
      updatedAt: 1000,
      ...overrides.custom,
    } as SessionCustom,
  };
}

function resolved(chatId: string, path: string): TranscriptResolution {
  return { chatId, state: 'resolved', path };
}

describe('buildSessionMentionItems — ordering', () => {
  it('returns three resolved sessions most-recent-first', () => {
    const sessions = [
      session({ remoteId: 'c1', title: 'Oldest', custom: { updatedAt: 100 } }),
      session({ remoteId: 'c2', title: 'Newest', custom: { updatedAt: 300 } }),
      session({ remoteId: 'c3', title: 'Middle', custom: { updatedAt: 200 } }),
    ];
    const resolutions = new Map([
      ['c1', resolved('c1', '/t/c1.jsonl')],
      ['c2', resolved('c2', '/t/c2.jsonl')],
      ['c3', resolved('c3', '/t/c3.jsonl')],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items.map((i) => i.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('tie-breaks equal updatedAt on remoteId ascending', () => {
    const sessions = [
      session({ remoteId: 'cB', title: 'B', custom: { updatedAt: 500 } }),
      session({ remoteId: 'cA', title: 'A', custom: { updatedAt: 500 } }),
    ];
    const resolutions = new Map([
      ['cA', resolved('cA', '/t/a.jsonl')],
      ['cB', resolved('cB', '/t/b.jsonl')],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items.map((i) => i.id)).toEqual(['cA', 'cB']);
  });
});

describe('buildSessionMentionItems — exclusions', () => {
  it('excludes the active chat id', () => {
    const sessions = [session({ remoteId: 'active', title: 'Active' }), session({ remoteId: 'other', title: 'Other' })];
    const resolutions = new Map([
      ['active', resolved('active', '/t/active.jsonl')],
      ['other', resolved('other', '/t/other.jsonl')],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: 'active', resolutions });

    expect(items.map((i) => i.id)).toEqual(['other']);
  });

  it('excludes a session in another project', () => {
    const sessions = [
      session({ remoteId: 'mine', title: 'Mine' }),
      session({ remoteId: 'theirs', title: 'Theirs', custom: { projectId: 'proj-2' } }),
    ];
    const resolutions = new Map([
      ['mine', resolved('mine', '/t/mine.jsonl')],
      ['theirs', resolved('theirs', '/t/theirs.jsonl')],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items.map((i) => i.id)).toEqual(['mine']);
  });

  it('excludes a session resolved unavailable/never-started', () => {
    const sessions = [session({ remoteId: 'c1', title: 'C1' })];
    const resolutions = new Map<string, TranscriptResolution>([
      ['c1', { chatId: 'c1', state: 'unavailable', reason: 'never-started' }],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([]);
  });

  it('excludes a session resolved unavailable/transcript-missing', () => {
    const sessions = [session({ remoteId: 'c1', title: 'C1' })];
    const resolutions = new Map<string, TranscriptResolution>([
      ['c1', { chatId: 'c1', state: 'unavailable', reason: 'transcript-missing' }],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([]);
  });

  it('excludes a session resolved unknown', () => {
    const sessions = [session({ remoteId: 'c1', title: 'C1' })];
    const resolutions = new Map<string, TranscriptResolution>([['c1', { chatId: 'c1', state: 'unknown' }]]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([]);
  });

  it('excludes a session with no resolution entry at all', () => {
    const sessions = [session({ remoteId: 'c1', title: 'C1' })];
    const resolutions = new Map<string, TranscriptResolution>();

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([]);
  });

  it('returns an empty result when projectId is null', () => {
    const sessions = [session({ remoteId: 'c1', title: 'C1' })];
    const resolutions = new Map([['c1', resolved('c1', '/t/c1.jsonl')]]);

    const { items, pathByChatId } = buildSessionMentionItems({
      sessions,
      projectId: null,
      activeChatId: null,
      resolutions,
    });

    expect(items).toEqual([]);
    expect(pathByChatId).toEqual(new Map());
  });
});

describe('buildSessionMentionItems — label disambiguation', () => {
  it('disambiguates two identical titles as "X" and "X (2)"', () => {
    const sessions = [
      session({ remoteId: 'c1', title: 'Fix foo handling', custom: { updatedAt: 200 } }),
      session({ remoteId: 'c2', title: 'Fix foo handling', custom: { updatedAt: 100 } }),
    ];
    const resolutions = new Map([
      ['c1', resolved('c1', '/t/c1.jsonl')],
      ['c2', resolved('c2', '/t/c2.jsonl')],
    ]);

    const { items, pathByChatId } = buildSessionMentionItems({
      sessions,
      projectId: PROJECT,
      activeChatId: null,
      resolutions,
    });

    expect(items).toEqual([
      { id: 'c1', type: 'session', label: 'Fix foo handling' },
      { id: 'c2', type: 'session', label: 'Fix foo handling (2)' },
    ]);
    expect(pathByChatId).toEqual(
      new Map([
        ['c1', '/t/c1.jsonl'],
        ['c2', '/t/c2.jsonl'],
      ]),
    );
  });

  it('disambiguates two titles that sanitize to the same label', () => {
    const sessions = [
      session({ remoteId: 'c1', title: 'Fix `foo` handling', custom: { updatedAt: 200 } }),
      session({ remoteId: 'c2', title: 'Fix *foo* handling', custom: { updatedAt: 100 } }),
    ];
    const resolutions = new Map([
      ['c1', resolved('c1', '/t/c1.jsonl')],
      ['c2', resolved('c2', '/t/c2.jsonl')],
    ]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([
      { id: 'c1', type: 'session', label: 'Fix foo handling' },
      { id: 'c2', type: 'session', label: 'Fix foo handling (2)' },
    ]);
  });

  it('labels an untitled session "Untitled session"', () => {
    const sessions = [session({ remoteId: 'c1', title: undefined })];
    const resolutions = new Map([['c1', resolved('c1', '/t/c1.jsonl')]]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items).toEqual([{ id: 'c1', type: 'session', label: 'Untitled session' }]);
  });
});

describe('buildSessionMentionItems — no description field', () => {
  it('carries no description on any item', () => {
    const sessions = [session({ remoteId: 'c1', title: 'Has a title' })];
    const resolutions = new Map([['c1', resolved('c1', '/t/c1.jsonl')]]);

    const { items } = buildSessionMentionItems({ sessions, projectId: PROJECT, activeChatId: null, resolutions });

    expect(items[0]).not.toHaveProperty('description');
  });
});
