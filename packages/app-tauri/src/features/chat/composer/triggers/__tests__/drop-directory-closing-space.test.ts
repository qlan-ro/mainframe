import { describe, it, expect } from 'vitest';
import { dropDirectoryClosingSpace } from '../directive-formatter';

describe('dropDirectoryClosingSpace', () => {
  it('strips the trailing space after a directory directive at the end of input', () => {
    expect(dropDirectoryClosingSpace('@/Users/doru/.agents/ ', '/Users/doru/.agents')).toBe('@/Users/doru/.agents/');
  });

  it('leaves text unchanged when the directive+space is not at the end (trailing text present)', () => {
    expect(dropDirectoryClosingSpace('@/a/ more text', '/a')).toBe('@/a/ more text');
  });

  it('leaves text unchanged when dirId does not match the tail', () => {
    expect(dropDirectoryClosingSpace('@/a/b/ ', '/x')).toBe('@/a/b/ ');
  });

  it('leaves text unchanged when there is no trailing space (already stripped or mid-typing)', () => {
    expect(dropDirectoryClosingSpace('@/a/', '/a')).toBe('@/a/');
  });

  it('preserves preceding text and only removes the final space after the matching directive', () => {
    expect(dropDirectoryClosingSpace('hey @/src/components/ ', '/src/components')).toBe('hey @/src/components/');
  });
});
