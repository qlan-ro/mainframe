/**
 * markdown-block-range — pure hast-position → source-line-range mapper.
 *
 * Fixtures are rendered through the real react-markdown pipeline (remark-gfm +
 * remark-breaks, matching MarkdownPreview's plugin list) with a spy component
 * map that captures each element's `node` prop, so the positions under test
 * are the ones production actually produces — not hand-written guesses.
 */
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { getBlockRange, hasAnnotatedDescendantWithSameRange } from '../markdown-block-range';

type MdastElement = NonNullable<ExtraProps['node']>;

const ANNOTATED_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'table'] as const;

function spyComponent(tag: string, sink: Record<string, MdastElement[]>) {
  return function Spy({ node, children }: ExtraProps & { children?: ReactNode }) {
    if (node) {
      (sink[tag] ??= []).push(node);
    }
    return createElement(tag, null, children);
  };
}

/** Render markdown source and collect every annotated node's real hast element, keyed by tag, in document order. */
function collectNodes(source: string): Record<string, MdastElement[]> {
  const sink: Record<string, MdastElement[]> = {};
  const components = Object.fromEntries(ANNOTATED_TAGS.map((tag) => [tag, spyComponent(tag, sink)])) as Components;
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, remarkBreaks], components }, source));
  return sink;
}

describe('getBlockRange', () => {
  it('maps a hast node with position to its start/end line and joined source lines', () => {
    const source = 'hello world';
    const { p } = collectNodes(source);
    expect(getBlockRange(p![0]!, source)).toEqual({ startLine: 1, endLine: 1, lineContent: 'hello world' });
  });

  it("maps a nested list-item paragraph to the paragraph's own range, not the item's", () => {
    const source = '- one\n\n  second para\n\n- two';
    const { p } = collectNodes(source);
    expect(getBlockRange(p![1]!, source)).toEqual({ startLine: 3, endLine: 3, lineContent: '  second para' });
  });

  it('includes both fence delimiter lines for a fenced code block', () => {
    const source = '```js\nconsole.log(1);\n```';
    const { pre } = collectNodes(source);
    expect(getBlockRange(pre![0]!, source)).toEqual({
      startLine: 1,
      endLine: 3,
      lineContent: '```js\nconsole.log(1);\n```',
    });
  });

  it('maps a node with no position to null', () => {
    const noPosition = { type: 'element', tagName: 'p', properties: {}, children: [] } as MdastElement;
    expect(getBlockRange(noPosition, 'irrelevant')).toBeNull();
  });

  it('yields an empty quote once the range exceeds the 50-line inline cap', () => {
    const source = Array.from({ length: 51 }, (_, i) => `line ${i + 1}`).join('\n');
    const { p } = collectNodes(source);
    expect(getBlockRange(p![0]!, source)).toEqual({ startLine: 1, endLine: 51, lineContent: '' });
  });

  it('keeps the full quote right at the 50-line cap', () => {
    const source = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const { p } = collectNodes(source);
    expect(getBlockRange(p![0]!, source)).toEqual({ startLine: 1, endLine: 50, lineContent: source });
  });
});

describe('hasAnnotatedDescendantWithSameRange', () => {
  it('suppresses a blockquote whose only child is a same-range paragraph', () => {
    const { blockquote, p } = collectNodes('> a');
    expect(hasAnnotatedDescendantWithSameRange(blockquote![0]!)).toBe(true);
    expect(hasAnnotatedDescendantWithSameRange(p![0]!)).toBe(false);
  });

  it('suppresses a blockquote through an unannotated list wrapper', () => {
    const { blockquote } = collectNodes('> - a');
    expect(hasAnnotatedDescendantWithSameRange(blockquote![0]!)).toBe(true);
  });

  it('suppresses nothing when the blockquote spans more than its paragraphs', () => {
    const { blockquote } = collectNodes('> a\n>\n> b');
    expect(hasAnnotatedDescendantWithSameRange(blockquote![0]!)).toBe(false);
  });

  it('leaves only the innermost paragraph unsuppressed in a nested blockquote', () => {
    const { blockquote, p } = collectNodes('> > a');
    expect(hasAnnotatedDescendantWithSameRange(blockquote![0]!)).toBe(true);
    expect(hasAnnotatedDescendantWithSameRange(blockquote![1]!)).toBe(true);
    expect(hasAnnotatedDescendantWithSameRange(p![0]!)).toBe(false);
  });
});
