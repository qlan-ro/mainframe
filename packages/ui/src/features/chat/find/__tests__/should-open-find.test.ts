// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { shouldOpenFind } from '../should-open-find';

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

describe('shouldOpenFind', () => {
  it('returns true for a target outside any .cm-editor', () => {
    host = document.createElement('div');
    const input = document.createElement('input');
    host.appendChild(input);
    document.body.appendChild(host);
    expect(shouldOpenFind(input)).toBe(true);
  });

  it('returns false when the target is inside a .cm-editor', () => {
    host = document.createElement('div');
    host.className = 'cm-editor';
    const inner = document.createElement('span');
    host.appendChild(inner);
    document.body.appendChild(host);
    expect(shouldOpenFind(inner)).toBe(false);
  });

  it('returns false when the target IS the .cm-editor', () => {
    host = document.createElement('div');
    host.className = 'cm-editor';
    document.body.appendChild(host);
    expect(shouldOpenFind(host)).toBe(false);
  });

  it('returns true for a null target', () => {
    expect(shouldOpenFind(null)).toBe(true);
  });

  it('returns true for a non-Element EventTarget', () => {
    expect(shouldOpenFind(new EventTarget())).toBe(true);
  });
});
