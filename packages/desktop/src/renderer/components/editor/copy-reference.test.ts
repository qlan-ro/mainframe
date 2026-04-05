import { describe, expect, it } from 'vitest';
import { buildReference } from './copy-reference';

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
