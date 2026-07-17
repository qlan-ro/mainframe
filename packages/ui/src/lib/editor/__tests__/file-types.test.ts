import { describe, expect, it } from 'vitest';
import { inferLanguage, getFileIcon } from '../file-types';

describe('inferLanguage', () => {
  it.each([
    { path: '/path/to/file.ts', language: 'typescript' },
    { path: '/path/to/Component.tsx', language: 'typescript' },
    { path: '/path/to/file.js', language: 'javascript' },
    { path: '/path/to/file.jsx', language: 'javascript' },
    { path: 'config.json', language: 'json' },
    { path: 'README.md', language: 'markdown' },
    { path: 'styles.css', language: 'css' },
    { path: 'index.html', language: 'html' },
    { path: 'script.py', language: 'python' },
    { path: 'main.rs', language: 'rust' },
    { path: 'config.yaml', language: 'yaml' },
    { path: 'config.yml', language: 'yaml' },
    { path: 'Cargo.toml', language: 'toml' },
    { path: 'main.go', language: 'go' },
    { path: 'schema.sql', language: 'sql' },
    { path: 'script.sh', language: 'shell' },
    { path: 'install.bash', language: 'shell' },
    { path: 'App.scala', language: 'scala' },
    { path: 'Main.java', language: 'java' },
  ])('maps $path to $language', ({ path, language }) => {
    expect(inferLanguage(path)).toBe(language);
  });

  it('returns plaintext for unknown extensions', () => {
    expect(inferLanguage('file.unknownext')).toBe('plaintext');
  });

  it('returns plaintext for no extension', () => {
    expect(inferLanguage('Makefile')).toBe('plaintext');
  });

  it('is case-insensitive for extensions', () => {
    expect(inferLanguage('FILE.TS')).toBe('typescript');
    expect(inferLanguage('FILE.PY')).toBe('python');
  });
});

describe('getFileIcon', () => {
  it('returns a non-empty string for known types', () => {
    expect(getFileIcon('file.ts').length).toBeGreaterThan(0);
    expect(getFileIcon('file.py').length).toBeGreaterThan(0);
  });

  it('returns a fallback for unknown types', () => {
    expect(getFileIcon('file.unknownxyz').length).toBeGreaterThan(0);
  });
});
