import { describe, it, expect, vi } from 'vitest';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  shouldCloseTriggerOnInsert,
} from '../directive-formatter';

describe('literalDirectiveFormatter', () => {
  describe('with "@" prefix', () => {
    const fmt = literalDirectiveFormatter('@');

    // `insertDirective` (the engine's own insertion, not the formatter) owns
    // the trailing space via `appendSpace` — serialize() must emit none.
    it('serialize inserts prefix + id with no trailing space', () => {
      const result = fmt.serialize({ id: 'src/a.ts', type: 'file', label: 'a.ts' });
      expect(result).toBe('@src/a.ts');
    });

    it('serialize works for a nested path', () => {
      const result = fmt.serialize({ id: 'src/lib/api/files.ts', type: 'file', label: 'files.ts' });
      expect(result).toBe('@src/lib/api/files.ts');
    });
  });

  describe('with "/" prefix', () => {
    const fmt = literalDirectiveFormatter('/');

    it('serialize inserts prefix + id with no trailing space', () => {
      const result = fmt.serialize({ id: 'my-skill', type: 'skill', label: 'My Skill' });
      expect(result).toBe('/my-skill');
    });

    it('serialize works with a scoped invocation name', () => {
      const result = fmt.serialize({ id: 'plugin:code-review', type: 'skill', label: 'Code Review' });
      expect(result).toBe('/plugin:code-review');
    });
  });
});

// ---------------------------------------------------------------------------
// mentionDirectiveFormatter
// ---------------------------------------------------------------------------

describe('mentionDirectiveFormatter', () => {
  const fmt = mentionDirectiveFormatter();

  describe('serialize', () => {
    it('file item → @<id> with no trailing space', () => {
      expect(fmt.serialize({ id: 'src/foo.ts', type: 'file', label: 'foo.ts' })).toBe('@src/foo.ts');
    });

    it('agent item → @<id> with no trailing space', () => {
      expect(fmt.serialize({ id: 'agent-name', type: 'agent', label: 'agent-name' })).toBe('@agent-name');
    });

    it('directory item → @<id>/ with NO trailing space (keeps token open for drill-down)', () => {
      expect(fmt.serialize({ id: 'src/components', type: 'directory', label: 'components' })).toBe('@src/components/');
    });

    // A session token carries the reference LABEL, never the chat id: the label
    // is what the sent message's chip displays and what the reference line keys on.
    // The draft spells it bare — `expandSessionMentions` adds `session[…]` at submit.
    it('session item → @<label> when no label resolver is given', () => {
      expect(fmt.serialize({ id: 'chat-1', type: 'session', label: 'Fix the parser' })).toBe('@Fix the parser');
    });
  });

  describe('serialize with a label resolver', () => {
    it('session item uses the resolved label, not the item label', () => {
      const withResolver = mentionDirectiveFormatter(() => 'Foo (2)');
      expect(withResolver.serialize({ id: 'chat-2', type: 'session', label: 'Foo' })).toBe('@Foo (2)');
    });

    it('the resolver is never consulted for a file item', () => {
      const resolve = vi.fn(() => 'Foo (2)');
      const withResolver = mentionDirectiveFormatter(resolve);

      expect(withResolver.serialize({ id: 'src/foo.ts', type: 'file', label: 'foo.ts' })).toBe('@src/foo.ts');
      expect(resolve).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// shouldCloseTriggerOnInsert
// ---------------------------------------------------------------------------

describe('shouldCloseTriggerOnInsert', () => {
  it('returns false for a directory item (keeps the token open for drill-down)', () => {
    expect(shouldCloseTriggerOnInsert({ id: 'src', type: 'directory', label: 'src' })).toBe(false);
  });

  it('returns true for a file item', () => {
    expect(shouldCloseTriggerOnInsert({ id: 'src/a.ts', type: 'file', label: 'a.ts' })).toBe(true);
  });

  it('returns true for an agent item', () => {
    expect(shouldCloseTriggerOnInsert({ id: 'agent-name', type: 'agent', label: 'agent-name' })).toBe(true);
  });

  it('returns true for a skill item', () => {
    expect(shouldCloseTriggerOnInsert({ id: 'my-skill', type: 'skill', label: 'My Skill' })).toBe(true);
  });

  it('returns true for a session item (the token is complete on insert)', () => {
    expect(shouldCloseTriggerOnInsert({ id: 'chat-1', type: 'session', label: 'Fix the parser' })).toBe(true);
  });
});
