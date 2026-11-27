import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import type { Root } from 'mdast';
import { unified, type Processor } from 'unified';
import { MarkdownBody, MarkdownText } from '../markdown-text';
import { MarkdownParseCache, TREE_BYTES_PER_CHAR, markdownParseCache, withParseCache } from '../markdown-parse-cache';

/** A parser that counts its calls: one text node per document. */
function counting() {
  const calls: string[] = [];
  function fakeParse(this: Processor) {
    this.parser = (doc: string) => {
      calls.push(doc);
      return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: doc }] }] } as Root;
    };
  }
  return { calls, fakeParse };
}

/** A transformer that edits the tree in place, as `remarkAppLinks` does. */
function appendMark() {
  return (tree: Root) => {
    tree.children.push({ type: 'thematicBreak' });
  };
}

const TRANSFORMS = [appendMark];

/** A fresh processor per mount, as react-markdown builds one per render. */
function processor(cache: MarkdownParseCache, parser: ReturnType<typeof counting>) {
  return unified().use(parser.fakeParse).use(withParseCache(TRANSFORMS, cache));
}

afterEach(() => {
  cleanup();
  markdownParseCache.clear();
});

describe('markdown parse cache', () => {
  it('parses a settled text once, however often it is mounted again', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    const run = (doc: string) => {
      const p = processor(cache, parser);
      return p.runSync(p.parse(doc));
    };
    run('hello');
    run('hello');
    run('hello');
    expect(parser.calls).toEqual(['hello']);
  });

  it('hands every read its own tree: an in-place transform never reaches the kept copy', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    const run = (doc: string) => {
      const p = processor(cache, parser);
      return p.runSync(p.parse(doc)) as Root;
    };
    const first = run('hello');
    const second = run('hello');
    // One break each: a shared tree would carry the first run's break into the second.
    expect(first.children.map((node) => node.type)).toEqual(['paragraph', 'thematicBreak']);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('keeps one key space per plugin list, since the list decides the syntax', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    const one = unified().use(parser.fakeParse).use(withParseCache([], cache));
    const other = unified().use(parser.fakeParse).use(withParseCache([], cache));
    one.parse('same');
    other.parse('same');
    expect(parser.calls).toEqual(['same', 'same']);
  });

  it('stays within its budget, dropping the least recently read first', () => {
    const tree = { type: 'root', children: [] } as Root;
    // Room for exactly two four-character keys.
    const cache = new MarkdownParseCache(8 * TREE_BYTES_PER_CHAR);
    cache.keep('aaaa', tree);
    cache.keep('bbbb', tree);
    cache.take('aaaa');
    cache.keep('cccc', tree);
    expect(cache.take('bbbb')).toBeUndefined();
    expect(cache.take('aaaa')).toBeDefined();
    expect(cache.take('cccc')).toBeDefined();
    expect(cache.bytes).toBeLessThanOrEqual(8 * TREE_BYTES_PER_CHAR);
  });

  it('does not keep a text bigger than the whole budget', () => {
    const cache = new MarkdownParseCache(2 * TREE_BYTES_PER_CHAR);
    cache.keep('too long', { type: 'root', children: [] });
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});

describe('MarkdownBody and the parse cache', () => {
  it('keeps the blocks of a settled reply, and renders them the same on the next mount', () => {
    const text = 'First **bold** line.\n\nOpen vscode://file/src/a.ts here.';
    const first = render(<MarkdownBody text={text} cacheParse />);
    const html = first.container.innerHTML;
    expect(markdownParseCache.size).toBeGreaterThan(0);
    first.unmount();
    const second = render(<MarkdownBody text={text} cacheParse />);
    // The app link is a transform over the parsed tree: it is there again on a mount served from the cache.
    expect(second.container.querySelector('a')?.textContent).toBe('vscode://file/src/a.ts');
    expect(second.container.innerHTML).toBe(html);
  });

  it('keeps nothing from text that is still streaming', () => {
    render(<MarkdownBody text="Still **typ" running />);
    expect(markdownParseCache.size).toBe(0);
  });

  it('keeps a reply part once it has settled, and nothing while it streams', async () => {
    const part = (text: string, running: boolean) => (
      <TextMessagePartProvider text={text} isRunning={running}>
        <MarkdownText type="text" text={text} status={running ? { type: 'running' } : { type: 'complete' }} />
      </TextMessagePartProvider>
    );
    const streaming = render(part('Partial **answer', true));
    // The typing reveal starts empty: wait until the streamed text has been parsed and drawn.
    await waitFor(() => expect(streaming.container.textContent).toContain('answer'));
    expect(markdownParseCache.size).toBe(0);
    streaming.unmount();
    render(part('Settled **answer**.', false));
    expect(markdownParseCache.size).toBeGreaterThan(0);
  });
});
