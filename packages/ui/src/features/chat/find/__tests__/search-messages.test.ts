// @vitest-environment jsdom
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

/**
 * An unresolved smart-action token splits one paragraph into three ADJACENT
 * text nodes: `SmartActionSpan` renders a bare fragment, so "Run ",
 * "/unknown-name" and " first" are siblings with no element between them.
 * `innerHTML` would collapse them into a single node, so they are appended by
 * hand to reproduce the rendered shape.
 */
function mountSplitTokenThread(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-mf-chat-thread', '');
  const message = document.createElement('div');
  message.setAttribute('data-message-id', 'm1');
  const part = document.createElement('div');
  part.setAttribute('data-text-part', '');
  part.append(
    document.createTextNode('Run '),
    document.createTextNode('/unknown-name'),
    document.createTextNode(' first'),
  );
  message.appendChild(part);
  el.appendChild(message);
  document.body.appendChild(el);
  return el;
}

describe('searchMessages — smart-action token split', () => {
  beforeEach(() => {
    root = mountSplitTokenThread();
  });

  it('reports offsets against the joined text of the split nodes', () => {
    expect(searchMessages('unknown')).toEqual([{ messageId: 'm1', partIndex: 0, charStart: 5, charEnd: 12 }]);
  });

  it('matches a query that spans the node boundary', () => {
    expect(searchMessages('Run /unknown-name f')).toEqual([
      { messageId: 'm1', partIndex: 0, charStart: 0, charEnd: 19 },
    ]);
  });

  it('highlights a boundary-spanning match across all three nodes', () => {
    const part = root!.querySelector('[data-text-part]')!;
    expect(rangeFromOffsets(part, 0, 19)!.toString()).toBe('Run /unknown-name f');
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
