import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchMessages, rangeFromOffsets } from '../search-messages';

function mountThread(html: string) {
  const root = document.createElement('div');
  root.setAttribute('data-mf-chat-thread', '');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

let root: HTMLElement | null = null;
afterEach(() => {
  root?.remove();
  root = null;
});

describe('searchMessages', () => {
  beforeEach(() => {
    root = mountThread(`
      <div data-message-id="m1"><div data-text-part>Hello world, hello again</div></div>
      <div data-message-id="m2"><div data-text-part>No matches here</div></div>
    `);
  });

  it('returns [] for an empty query', () => {
    expect(searchMessages('')).toEqual([]);
  });

  it('returns [] when no thread element is present', () => {
    root?.remove();
    root = null;
    expect(searchMessages('hello')).toEqual([]);
  });

  it('finds case-insensitive matches with correct offsets and ordering', () => {
    const matches = searchMessages('hello');
    expect(matches).toEqual([
      { messageId: 'm1', partIndex: 0, charStart: 0, charEnd: 5 },
      { messageId: 'm1', partIndex: 0, charStart: 13, charEnd: 18 },
    ]);
  });

  it('finds multiple parts within a message with per-message partIndex', () => {
    root?.remove();
    root = mountThread(`
      <div data-message-id="m1">
        <div data-text-part>alpha</div>
        <div data-text-part>alpha beta alpha</div>
      </div>
    `);
    const matches = searchMessages('alpha');
    expect(matches).toEqual([
      { messageId: 'm1', partIndex: 0, charStart: 0, charEnd: 5 },
      { messageId: 'm1', partIndex: 1, charStart: 0, charEnd: 5 },
      { messageId: 'm1', partIndex: 1, charStart: 11, charEnd: 16 },
    ]);
  });
});

describe('rangeFromOffsets', () => {
  it('maps flat offsets across nested text nodes into a Range', () => {
    root = mountThread(`<div data-message-id="m1"><div data-text-part>foo <b>bar</b> baz</div></div>`);
    const part = root.querySelector('[data-text-part]')!;
    // textContent = "foo bar baz"; match "bar" at 4..7 spans into the <b> text node.
    const range = rangeFromOffsets(part, 4, 7);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('bar');
  });

  it('returns null when offsets fall outside the text', () => {
    root = mountThread(`<div data-message-id="m1"><div data-text-part>short</div></div>`);
    const part = root.querySelector('[data-text-part]')!;
    expect(rangeFromOffsets(part, 100, 105)).toBeNull();
  });
});
