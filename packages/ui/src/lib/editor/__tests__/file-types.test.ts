import { describe, expect, it } from 'vitest';
import { inferLanguage, getFileIcon } from '../file-types';

describe('inferLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(inferLanguage('/path/to/file.ts')).toBe('typescript');
  });

  it('maps .tsx to typescript', () => {
    expect(inferLanguage('/path/to/Component.tsx')).toBe('typescript');
  });

  it('maps .js to javascript', () => {
    expect(inferLanguage('/path/to/file.js')).toBe('javascript');
  });

  it('maps .jsx to javascript', () => {
    expect(inferLanguage('/path/to/file.jsx')).toBe('javascript');
  });

  it('maps .json to json', () => {
    expect(inferLanguage('config.json')).toBe('json');
  });

  it('maps .md to markdown', () => {
    expect(inferLanguage('README.md')).toBe('markdown');
  });

  it('maps .css to css', () => {
    expect(inferLanguage('styles.css')).toBe('css');
  });

  it('maps .html to html', () => {
    expect(inferLanguage('index.html')).toBe('html');
  });

  it('maps .py to python', () => {
    expect(inferLanguage('script.py')).toBe('python');
  });

  it('maps .rs to rust', () => {
    expect(inferLanguage('main.rs')).toBe('rust');
  });

  it('maps .yaml to yaml', () => {
    expect(inferLanguage('config.yaml')).toBe('yaml');
  });

  it('maps .yml to yaml', () => {
    expect(inferLanguage('config.yml')).toBe('yaml');
  });

  it('maps .toml to toml', () => {
    expect(inferLanguage('Cargo.toml')).toBe('toml');
  });

  it('maps .go to go', () => {
    expect(inferLanguage('main.go')).toBe('go');
  });

  it('maps .sql to sql', () => {
    expect(inferLanguage('schema.sql')).toBe('sql');
  });

  it('maps .sh to shell', () => {
    expect(inferLanguage('script.sh')).toBe('shell');
  });

  it('maps .bash to shell', () => {
    expect(inferLanguage('install.bash')).toBe('shell');
  });

  it('maps .scala to scala', () => {
    expect(inferLanguage('App.scala')).toBe('scala');
  });

  it('maps .java to java', () => {
    expect(inferLanguage('Main.java')).toBe('java');
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
