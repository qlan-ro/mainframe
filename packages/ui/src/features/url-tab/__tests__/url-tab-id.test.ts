/**
 * urlTabId / urlTabTitle — pure identity helpers for a `url` workspace tab (#281).
 *
 * The id must be a valid webview-label fragment ([A-Za-z0-9_-] only, per the
 * plan's AC16) and unique per call so two tabs on the same URL never collide.
 * The title is the host the user sees in the tab strip.
 */
import { describe, it, expect } from 'vitest';
import { urlTabId, urlTabTitle } from '../url-tab-id';

describe('urlTabId', () => {
  it('matches the sanitized id charset', () => {
    expect(urlTabId('http://localhost:5173/a/b?q=1#frag')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a different id on each call for the same URL', () => {
    const first = urlTabId('http://localhost:5173/');
    const second = urlTabId('http://localhost:5173/');
    expect(first).not.toBe(second);
  });
});

describe('urlTabTitle', () => {
  it('is the host and port for a non-default port', () => {
    expect(urlTabTitle('http://localhost:5173/a?q=1')).toBe('localhost:5173');
  });

  it('omits the port when it is the scheme default', () => {
    expect(urlTabTitle('https://example.com/x')).toBe('example.com');
  });
});
