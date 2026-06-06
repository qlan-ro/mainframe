import { describe, it, expect } from 'vitest';
import { literalDirectiveFormatter } from '../directive-formatter';

describe('literalDirectiveFormatter', () => {
  describe('with "@" prefix', () => {
    const fmt = literalDirectiveFormatter('@');

    it('serialize inserts prefix + id + trailing space', () => {
      const result = fmt.serialize({ id: 'src/a.ts', type: 'file', label: 'a.ts' });
      expect(result).toBe('@src/a.ts ');
    });

    it('serialize works for a nested path', () => {
      const result = fmt.serialize({ id: 'src/lib/api/files.ts', type: 'file', label: 'files.ts' });
      expect(result).toBe('@src/lib/api/files.ts ');
    });
  });

  describe('with "/" prefix', () => {
    const fmt = literalDirectiveFormatter('/');

    it('serialize inserts prefix + id + trailing space', () => {
      const result = fmt.serialize({ id: 'my-skill', type: 'skill', label: 'My Skill' });
      expect(result).toBe('/my-skill ');
    });

    it('serialize works with a scoped invocation name', () => {
      const result = fmt.serialize({ id: 'plugin:code-review', type: 'skill', label: 'Code Review' });
      expect(result).toBe('/plugin:code-review ');
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
