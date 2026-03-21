import { describe, it, expect } from 'vitest';
import { getLspLanguage, hasLspSupport } from '../language-detection.js';

describe('getLspLanguage', () => {
  it('maps TypeScript extensions to typescript', () => {
    expect(getLspLanguage('foo.ts')).toBe('typescript');
    expect(getLspLanguage('bar.tsx')).toBe('typescript');
    expect(getLspLanguage('baz.js')).toBe('typescript');
    expect(getLspLanguage('qux.jsx')).toBe('typescript');
  });

  it('maps Python extensions to python', () => {
    expect(getLspLanguage('foo.py')).toBe('python');
    expect(getLspLanguage('bar.pyi')).toBe('python');
  });

  it('maps Java extension to java', () => {
    expect(getLspLanguage('Foo.java')).toBe('java');
  });

  it('returns null for unsupported extensions', () => {
    expect(getLspLanguage('foo.rs')).toBeNull();
    expect(getLspLanguage('bar.go')).toBeNull();
    expect(getLspLanguage('baz.md')).toBeNull();
  });
});

describe('hasLspSupport', () => {
  it('returns true for supported files', () => {
    expect(hasLspSupport('foo.ts')).toBe(true);
    expect(hasLspSupport('bar.py')).toBe(true);
  });

  it('returns false for unsupported files', () => {
    expect(hasLspSupport('foo.rs')).toBe(false);
  });
});
