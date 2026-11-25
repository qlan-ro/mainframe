// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { quoteSource, selectedMessageId } from '../quote-source';

const NOW = new Date(2026, 10, 24, 23, 59);
const clock = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

describe('quoteSource', () => {
  it('names the reply, or the user’s own message, and its time', () => {
    const at = new Date(2026, 10, 24, 23, 27);
    expect(quoteSource({ role: 'assistant', createdAt: at }, NOW)).toBe(`From the reply at ${clock(at)}`);
    expect(quoteSource({ role: 'user', createdAt: at }, NOW)).toBe(`From your message at ${clock(at)}`);
  });

  it('adds the day when it was not today, so a time alone never misleads', () => {
    const yesterday = new Date(2026, 10, 23, 23, 27);
    const day = yesterday.toLocaleDateString([], { day: 'numeric', month: 'short' });
    expect(quoteSource({ role: 'assistant', createdAt: yesterday }, NOW)).toBe(
      `From the reply, ${day} at ${clock(yesterday)}`,
    );
    expect(quoteSource({ role: 'assistant', createdAt: new Date(2025, 10, 24, 23, 27) }, NOW)).toContain('2025');
  });

  it('says what it can without a time', () => {
    expect(quoteSource({ role: 'assistant' }, NOW)).toBe('From the reply');
  });
});

describe('selectedMessageId', () => {
  it('is the message the selection starts in, and nothing outside one', () => {
    document.body.innerHTML = '<div data-message-id="m1"><p>one <b>two</b></p></div><p id="out">three</p>';
    const anchoredIn = (node: Node | null) => ({ anchorNode: node }) as Selection;
    expect(selectedMessageId(anchoredIn(document.querySelector('b')!.firstChild))).toBe('m1');
    expect(selectedMessageId(anchoredIn(document.querySelector('p')))).toBe('m1');
    expect(selectedMessageId(anchoredIn(document.getElementById('out')!.firstChild))).toBeUndefined();
    expect(selectedMessageId(null)).toBeUndefined();
  });
});
