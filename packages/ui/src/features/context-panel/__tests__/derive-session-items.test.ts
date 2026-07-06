import { describe, expect, it } from 'vitest';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { deriveSessionItems, sessionItemCount } from '../derive-session-items';

function ctx(partial: Partial<SessionContext>): SessionContext {
  return {
    globalFiles: [],
    projectFiles: [],
    mentions: [],
    attachments: [],
    modifiedFiles: [],
    skillFiles: [],
    ...partial,
  };
}

describe('deriveSessionItems', () => {
  it('badges a user file mention with @ and an auto mention with auto', () => {
    const result = deriveSessionItems(
      ctx({
        mentions: [
          { id: '1', kind: 'file', source: 'user', name: 'a', path: 'src/a.ts', timestamp: 't' },
          { id: '2', kind: 'file', source: 'auto', name: 'b', path: 'src/b.ts', timestamp: 't' },
        ],
      }),
    );
    expect(result).toEqual([
      { path: 'src/a.ts', badge: '@' },
      { path: 'src/b.ts', badge: 'auto' },
    ]);
  });

  it('ignores non-file and attachment-sourced mentions', () => {
    const result = deriveSessionItems(
      ctx({
        mentions: [
          { id: '1', kind: 'agent', source: 'user', name: 'x', path: 'src/x.ts', timestamp: 't' },
          { id: '2', kind: 'file', source: 'attachment', name: 'y', path: 'src/y.ts', timestamp: 't' },
          { id: '3', kind: 'file', source: 'user', name: 'z', timestamp: 't' },
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  it('badges a modified-only file plan and keeps an existing mention badge', () => {
    const result = deriveSessionItems(
      ctx({
        mentions: [{ id: '1', kind: 'file', source: 'user', name: 'a', path: 'src/a.ts', timestamp: 't' }],
        modifiedFiles: ['src/a.ts', 'src/m.ts'],
      }),
    );
    expect(result).toEqual([
      { path: 'src/a.ts', badge: '@' },
      { path: 'src/m.ts', badge: 'plan' },
    ]);
  });

  it('adds skill files with the skill badge + displayName only when not already present', () => {
    const result = deriveSessionItems(
      ctx({
        modifiedFiles: ['src/a.ts'],
        skillFiles: [
          { path: 'src/a.ts', displayName: 'Already' },
          { path: 'skills/run.sh', displayName: 'Run Tests' },
        ],
      }),
    );
    expect(result).toEqual([
      { path: 'src/a.ts', badge: 'plan' },
      { path: 'skills/run.sh', badge: 'skill', displayName: 'Run Tests' },
    ]);
  });

  it('sessionItemCount counts derived items plus attachments', () => {
    const c = ctx({
      mentions: [{ id: '1', kind: 'file', source: 'user', name: 'a', path: 'src/a.ts', timestamp: 't' }],
      attachments: [
        { id: 'att1', name: 'p.png', mediaType: 'image/png', sizeBytes: 1, kind: 'image' },
        { id: 'att2', name: 'd.pdf', mediaType: 'application/pdf', sizeBytes: 1, kind: 'file' },
      ],
    });
    expect(sessionItemCount(c)).toBe(3);
  });
});
