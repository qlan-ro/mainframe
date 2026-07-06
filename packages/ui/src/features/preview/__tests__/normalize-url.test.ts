import { describe, it, expect } from 'vitest';
import { normalizePreviewUrl } from '../normalize-url';

describe('normalizePreviewUrl', () => {
  it('prepends http:// to a bare host:port/path', () => {
    expect(normalizePreviewUrl('localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('prepends http:// to a bare domain', () => {
    expect(normalizePreviewUrl('example.com')).toBe('http://example.com/');
  });

  it('leaves an http URL unchanged (normalized form)', () => {
    expect(normalizePreviewUrl('http://localhost:3000/a')).toBe('http://localhost:3000/a');
  });

  it('leaves an https URL unchanged', () => {
    expect(normalizePreviewUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizePreviewUrl('  localhost:3000  ')).toBe('http://localhost:3000/');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(normalizePreviewUrl('')).toBeNull();
    expect(normalizePreviewUrl('   ')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(normalizePreviewUrl('http://')).toBeNull();
    expect(normalizePreviewUrl('::::')).toBeNull();
  });
});
