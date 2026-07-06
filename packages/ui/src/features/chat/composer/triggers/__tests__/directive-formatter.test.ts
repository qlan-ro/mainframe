import { describe, it, expect } from 'vitest';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  shouldCloseTriggerOnInsert,
} from '../directive-formatter';

describe('literalDirectiveFormatter', () => {
  describe('with "@" prefix', () => {
    const fmt = literalDirectiveFormatter('@');

    // The native TriggerSelectionResource.insertDirective (assistant-ui) ALWAYS
    // appends its own separating space before the text after the cursor (unless
    // that text already starts with one) — see triggerSelectionResource.js:
    // `before + directive + (after.startsWith(" ") ? after : " " + after)`.
    // If serialize() also appended a trailing space, insertion would compose
    // to a double space ("/skill  "). serialize() must emit NO trailing space
    // so the native insertion produces exactly one.
    it('serialize inserts prefix + id with NO trailing space (the native popover adds exactly one)', () => {
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

    it('serialize inserts prefix + id with NO trailing space (the native popover adds exactly one)', () => {
      const result = fmt.serialize({ id: 'my-skill', type: 'skill', label: 'My Skill' });
      expect(result).toBe('/my-skill');
    });

    it('serialize works with a scoped invocation name', () => {
      const result = fmt.serialize({ id: 'plugin:code-review', type: 'skill', label: 'Code Review' });
      expect(result).toBe('/plugin:code-review');
    });
  });

  describe('parse', () => {
    const fmt = literalDirectiveFormatter('@');

    it('returns a single text segment with the full input', () => {
      const segments = fmt.parse('hello @x /y');
      expect(segments).toEqual([{ kind: 'text', text: 'hello @x /y' }]);
    });

    it('returns a single text segment for an empty string', () => {
      const segments = fmt.parse('');
      expect(segments).toEqual([{ kind: 'text', text: '' }]);
    });

    it('does not produce mention segments even when prefixed text is present', () => {
      const segments = fmt.parse('@src/index.ts /my-skill');
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'text', text: '@src/index.ts /my-skill' });
    });
  });
});

// ---------------------------------------------------------------------------
// mentionDirectiveFormatter
// ---------------------------------------------------------------------------

describe('mentionDirectiveFormatter', () => {
  const fmt = mentionDirectiveFormatter();

  describe('serialize', () => {
    // Same reasoning as literalDirectiveFormatter above: the native trigger
    // insertion always adds its own single space, so serialize() must not.
    it('file item → @<id> with NO trailing space (the native popover adds exactly one)', () => {
      expect(fmt.serialize({ id: 'src/foo.ts', type: 'file', label: 'foo.ts' })).toBe('@src/foo.ts');
    });

    it('agent item → @<id> with NO trailing space (the native popover adds exactly one)', () => {
      expect(fmt.serialize({ id: 'agent-name', type: 'agent', label: 'agent-name' })).toBe('@agent-name');
    });

    it('directory item → @<id>/ with NO trailing space (keeps token open for drill-down)', () => {
      expect(fmt.serialize({ id: 'src/components', type: 'directory', label: 'components' })).toBe('@src/components/');
    });
  });

  describe('parse', () => {
    it('returns a single text segment containing the full input — never produces directive chips', () => {
      const segments = fmt.parse('any @x text');
      expect(segments).toEqual([{ kind: 'text', text: 'any @x text' }]);
    });

    it('returns a single text segment for an empty string', () => {
      expect(fmt.parse('')).toEqual([{ kind: 'text', text: '' }]);
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
