import { describe, expect, it } from 'vitest';
import { buildReference, findSymbolChain } from './copy-reference';

describe('buildReference', () => {
  it('tier 1: returns path::symbolChain when symbol chain is provided', () => {
    expect(buildReference('packages/core/src/auth.ts', 42, 'AuthService.validate')).toBe(
      'packages/core/src/auth.ts::AuthService.validate',
    );
  });

  it('tier 2: returns path:line (word) when only word is provided', () => {
    expect(buildReference('packages/core/src/auth.ts', 42, undefined, 'validate')).toBe(
      'packages/core/src/auth.ts:42 (validate)',
    );
  });

  it('tier 3: returns path:line when neither symbol nor word is available', () => {
    expect(buildReference('packages/core/src/auth.ts', 42)).toBe('packages/core/src/auth.ts:42');
  });

  it('uses "untitled" when filePath is undefined', () => {
    expect(buildReference(undefined, 10)).toBe('untitled:10');
  });

  it('applies lineOffset to line number in tier 2 and 3', () => {
    expect(buildReference('file.ts', 5, undefined, 'foo', 100)).toBe('file.ts:105 (foo)');
    expect(buildReference('file.ts', 5, undefined, undefined, 100)).toBe('file.ts:105');
  });

  it('does not apply lineOffset to tier 1 (symbol chain)', () => {
    expect(buildReference('file.ts', 5, 'MyClass.method', undefined, 100)).toBe('file.ts::MyClass.method');
  });
});

/**
 * NavigationTree shape from TS language service:
 * { text: string, kind: string, spans: Array<{ start: number, length: number }>, childItems?: NavigationTree[] }
 */

describe('findSymbolChain', () => {
  it('returns deepest matching symbol chain', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 200 }],
      childItems: [
        {
          text: 'MyClass',
          kind: 'class',
          spans: [{ start: 10, length: 100 }],
          childItems: [
            {
              text: 'validate',
              kind: 'method',
              spans: [{ start: 30, length: 20 }],
              childItems: [],
            },
          ],
        },
      ],
    };
    expect(findSymbolChain(tree, 35)).toBe('MyClass.validate');
  });

  it('returns single symbol when cursor is in class but not in a method', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 200 }],
      childItems: [
        {
          text: 'MyClass',
          kind: 'class',
          spans: [{ start: 10, length: 100 }],
          childItems: [
            {
              text: 'validate',
              kind: 'method',
              spans: [{ start: 30, length: 20 }],
              childItems: [],
            },
          ],
        },
      ],
    };
    expect(findSymbolChain(tree, 15)).toBe('MyClass');
  });

  it('returns top-level function name', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 100 }],
      childItems: [
        {
          text: 'helperFn',
          kind: 'function',
          spans: [{ start: 5, length: 40 }],
          childItems: [],
        },
      ],
    };
    expect(findSymbolChain(tree, 20)).toBe('helperFn');
  });

  it('returns undefined when cursor is outside all symbols', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 100 }],
      childItems: [
        {
          text: 'helperFn',
          kind: 'function',
          spans: [{ start: 50, length: 20 }],
          childItems: [],
        },
      ],
    };
    expect(findSymbolChain(tree, 5)).toBeUndefined();
  });

  it('returns undefined for empty tree', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 0 }],
      childItems: [],
    };
    expect(findSymbolChain(tree, 5)).toBeUndefined();
  });
});
