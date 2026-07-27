/**
 * Two layers:
 *   - mdast shape: the transformer runs over hand-built trees, so the splice
 *     boundaries are asserted directly rather than through a parser.
 *   - rendered HTML: `react-markdown` drives the real mdast → hast → JSX
 *     pipeline, which is the only place the `hName`/`hProperties` contract and
 *     the uncamelized `data-*` prop name can actually be observed.
 */
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { unified } from 'unified';
import type { Code, InlineCode, Paragraph, Root, RootContent, Text } from 'mdast';
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_ATTR, remarkSmartActions, type SmartActionText } from '../remark-smart-actions';

const processor = unified().use(remarkSmartActions);

function paragraphTree(...children: Paragraph['children']): Root {
  return { type: 'root', children: [{ type: 'paragraph', children }] };
}

function transform(tree: Root): RootContent[] {
  const out = processor.runSync(tree) as Root;
  const first = out.children[0] as Paragraph;
  return first.children as RootContent[];
}

function text(value: string): Text {
  return { type: 'text', value };
}

function expectMarker(node: RootContent, token: string): void {
  expect(node.type).toBe('smartActionText');
  const marker = node as SmartActionText;
  expect(marker.data).toEqual({ hName: 'span', hProperties: { [INSTRUCTION_ATTR]: token } });
  expect(marker.children).toEqual([{ type: 'text', value: token }]);
}

describe('remarkSmartActions — mdast shape', () => {
  it('splits a text node into text, marker, text around one instruction', () => {
    const children = transform(paragraphTree(text('Run /domain-modeling first')));

    expect(children).toHaveLength(3);
    expect(children[0]).toEqual({ type: 'text', value: 'Run ' });
    expectMarker(children[1]!, '/domain-modeling');
    expect(children[2]).toEqual({ type: 'text', value: ' first' });
  });

  it('carries the token in children, never in value', () => {
    const children = transform(paragraphTree(text('/codex:review')));

    expect(children).toHaveLength(1);
    const marker = children[0] as SmartActionText;
    expect(marker.children).toEqual([{ type: 'text', value: '/codex:review' }]);
    expect('value' in marker).toBe(false);
  });

  it('splices every instruction in one text node', () => {
    const children = transform(paragraphTree(text('/one then /two')));

    expect(children.map((child) => child.type)).toEqual(['smartActionText', 'text', 'smartActionText']);
    expectMarker(children[0]!, '/one');
    expect(children[1]).toEqual({ type: 'text', value: ' then ' });
    expectMarker(children[2]!, '/two');
  });

  it('leaves text alongside an untouched sibling in place', () => {
    const children = transform(
      paragraphTree(text('see '), { type: 'strong', children: [text('bold')] }, text(' and /plan')),
    );

    expect(children).toHaveLength(4);
    expect(children[0]).toEqual({ type: 'text', value: 'see ' });
    expect(children[1]!.type).toBe('strong');
    expect(children[2]).toEqual({ type: 'text', value: ' and ' });
    expectMarker(children[3]!, '/plan');
  });

  it('never touches text inside a link', () => {
    const children = transform(
      paragraphTree({ type: 'link', url: 'https://example.com', children: [text('/domain-modeling')] }),
    );

    expect(children).toHaveLength(1);
    const link = children[0] as { children: RootContent[] };
    expect(link.children).toEqual([{ type: 'text', value: '/domain-modeling' }]);
  });

  it('never touches inlineCode or fenced code', () => {
    const inlineCode: InlineCode = { type: 'inlineCode', value: '/domain-modeling' };
    const code: Code = { type: 'code', lang: 'sh', value: '/todo-pipeline run' };
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [inlineCode] }, code] };

    const out = processor.runSync(tree) as Root;

    expect((out.children[0] as Paragraph).children).toEqual([inlineCode]);
    expect(out.children[1]).toEqual(code);
  });

  it('leaves paths and file references alone', () => {
    for (const prose of ['see /usr/local/bin', 'open src/app.ts', 'read /README.md']) {
      const children = transform(paragraphTree(text(prose)));
      expect(children).toEqual([{ type: 'text', value: prose }]);
    }
  });
});

describe('remarkSmartActions — rendered output', () => {
  it('renders the token inside the marker span', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkSmartActions], children: '/domain-modeling next' }),
    );

    expect(html).toContain(`<span ${INSTRUCTION_ATTR}="/domain-modeling">/domain-modeling</span>`);
    expect(html).toContain(' next');
  });

  it('hands the override the uncamelized attribute name', () => {
    const seen: Record<string, unknown>[] = [];
    const SpanProbe = (props: ComponentProps<'span'>) => {
      seen.push(props as Record<string, unknown>);
      return createElement('span', null, props.children);
    };

    renderToStaticMarkup(
      createElement(Markdown, {
        remarkPlugins: [remarkSmartActions],
        components: { span: SpanProbe },
        children: '/domain-modeling',
      }),
    );

    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]!)).toContain(INSTRUCTION_ATTR);
    expect(seen[0]![INSTRUCTION_ATTR]).toBe('/domain-modeling');
  });
});
