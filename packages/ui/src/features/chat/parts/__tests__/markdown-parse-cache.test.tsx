import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import type { Root } from 'mdast';
import { unified, type Processor } from 'unified';
import { MarkdownBody, MarkdownText } from '../markdown-text';
import {
  BYTES_PER_CHAR,
  BYTES_PER_NODE,
  MarkdownParseCache,
  entryBytes,
  markdownParseCache,
  withParseCache,
  withoutKeep,
} from '../markdown-parse-cache';
import { isGrowingTail } from '../parse-cache-block';

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

  it('shares a key space between processors built from the same plugins', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    unified().use(parser.fakeParse).use(withParseCache(TRANSFORMS, cache)).parse('same');
    unified()
      .use(parser.fakeParse)
      .use(withParseCache([...TRANSFORMS], cache))
      .parse('same');
    expect(parser.calls).toEqual(['same']);
  });

  it('keys by the whole processor, including plugins added around the caller’s list', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    const list = withParseCache(TRANSFORMS, cache);
    // Streamdown appends its own plugins (cjk, math, literal tags) after the caller's list.
    const added = (_options?: { tags: string[] }) => () => undefined;
    unified().use(parser.fakeParse).use(list).parse('same');
    unified().use(parser.fakeParse).use(list).use(added).parse('same');
    unified()
      .use(parser.fakeParse)
      .use(list)
      .use(added, { tags: ['x'] })
      .parse('same');
    expect(parser.calls).toEqual(['same', 'same', 'same']);
  });

  it('reads through the read-only twin without keeping, in the same key space', () => {
    const cache = new MarkdownParseCache();
    const parser = counting();
    const list = withParseCache(TRANSFORMS, cache);
    const readOnly = withoutKeep(list);
    expect(withoutKeep(list)).toBe(readOnly);
    unified().use(parser.fakeParse).use(readOnly).parse('growing');
    expect(cache.size).toBe(0);
    unified().use(parser.fakeParse).use(list).parse('settled');
    unified().use(parser.fakeParse).use(readOnly).parse('settled');
    expect(parser.calls).toEqual(['growing', 'settled']);
  });

  it('sizes an entry by its nodes and its key', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'abc' }] }],
    } as Root;
    expect(entryBytes('abc', tree)).toBe(3 * BYTES_PER_NODE + 3 * BYTES_PER_CHAR);
  });

  it('stays within its budget, dropping the least recently read first', () => {
    const tree = { type: 'root', children: [] } as Root;
    // Room for exactly two entries of a four-character key.
    const budget = 2 * entryBytes('aaaa', tree);
    const cache = new MarkdownParseCache(budget);
    cache.keep('aaaa', tree);
    cache.keep('bbbb', tree);
    cache.take('aaaa');
    cache.keep('cccc', tree);
    expect(cache.take('bbbb')).toBeUndefined();
    expect(cache.take('aaaa')).toBeDefined();
    expect(cache.take('cccc')).toBeDefined();
    expect(cache.bytes).toBeLessThanOrEqual(budget);
  });

  it('does not keep a text bigger than the whole budget', () => {
    const tree = { type: 'root', children: [] } as Root;
    const cache = new MarkdownParseCache(entryBytes('too long', tree) - 1);
    cache.keep('too long', tree);
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

  it('keeps the finished blocks of a streaming reply, and only its tail when it settles', () => {
    const text = 'First paragraph.\n\nSecond **still typ';
    const view = render(<MarkdownBody text={text} running cacheParse />);
    // The finished block is kept; the growing tail is read, not kept.
    expect(markdownParseCache.size).toBe(1);
    const keep = vi.spyOn(markdownParseCache, 'keep');
    const done = 'First paragraph.\n\nSecond **still typing**.';
    view.rerender(<MarkdownBody text={done} running={false} cacheParse />);
    // Settling renders the tail block alone: the finished block keeps its render, and is not parsed again.
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep.mock.calls[0]![0]).toContain('still typing');
    expect(markdownParseCache.size).toBe(2);
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

describe('the growing tail of a streamed text', () => {
  it('is the last block: every earlier block ends with a newline', () => {
    const text = 'one\n\ntwo\n\nthr';
    expect(isGrowingTail('one\n\n', text)).toBe(false);
    expect(isGrowingTail('two\n\n', text)).toBe(false);
    expect(isGrowingTail('thr', text)).toBe(true);
  });

  it('is the last block too when the stream paused on a line break', () => {
    expect(isGrowingTail('- a\n- b\n', 'intro\n\n- a\n- b\n')).toBe(true);
  });

  it('is the last block when the repair closed its syntax', () => {
    // The repair appends what an unfinished tail is missing, so the block is not in the raw text.
    expect(isGrowingTail('```ts\nconst a = 1;\n```', 'Intro\n\n```ts\nconst a = 1;')).toBe(true);
  });
});
