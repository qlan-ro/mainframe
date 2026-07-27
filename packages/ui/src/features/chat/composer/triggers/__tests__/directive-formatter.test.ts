import { describe, it, expect } from 'vitest';
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
});
