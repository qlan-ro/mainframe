/**
 * Streaming markdown through `MarkdownBody` (Streamdown + the transcript's
 * component map): an unfinished tail renders as what it is becoming, and the
 * finished blocks above the tail do not render again while it grows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownBody } from '../markdown-text';

/** Counts renders of the list component, the first block in these documents. */
const listRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../markdown-lists', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../markdown-lists')>();
  function CountedUl(props: React.ComponentProps<'ul'>) {
    listRenders.count += 1;
    return <actual.MarkdownUl {...props} />;
  }
  return { ...actual, MarkdownUl: CountedUl };
});

describe('an unfinished tail while streaming', () => {
  it('an unclosed code fence is already a code block, with no stray backticks', () => {
    const { container } = render(<MarkdownBody running text={'Intro\n\n```ts\nconst a = 1;\nconst b'} />);
    const block = screen.getByTestId('chat-code-block');
    const lines = [...block.querySelectorAll('[data-slot="code-block-line"]')].map((l) => l.textContent);
    expect(lines).toEqual(['const a = 1;', 'const b']);
    expect(container.textContent).not.toContain('```');
  });

  it('half a table: a header and a partial row render as a table', () => {
    render(<MarkdownBody running text={'| Name | Size |\n| --- | --- |\n| alpha | 1'} />);
    const table = screen.getByRole('table');
    expect([...table.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Name', 'Size']);
    expect([...table.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['alpha', '1']);
  });

  it('a header with no complete delimiter row stays text until the table is real', () => {
    const { container } = render(<MarkdownBody running text={'| Name | Size |\n| --- |'} />);
    expect(container.querySelector('table')).toBeNull();
  });

  it('bold cut mid-word is bold, without the opening asterisks', () => {
    const { container } = render(<MarkdownBody running text="This is **impor" />);
    expect(container.querySelector('strong')).toHaveTextContent('impor');
    expect(container.textContent).toBe('This is impor');
  });

  it('a link cut mid-URL shows its text and no partial address', () => {
    const { container } = render(<MarkdownBody running text="See [the docs](https://exa" />);
    expect(container.textContent).toBe('See the docs');
    expect(container.querySelector('a[href]')).toBeNull();
  });

  it('once settled, the same text is left as written', () => {
    const { container } = render(<MarkdownBody text="This is **impor" />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('This is **impor');
  });
});

describe('finished blocks while the last one streams', () => {
  beforeEach(() => {
    listRenders.count = 0;
  });

  it('a finished list is not rendered again as the paragraph after it grows', () => {
    const head = '- one\n- two\n\nThe paragraph';
    const view = render(<MarkdownBody running text={head} />);
    const list = view.container.querySelector('ul');
    const renders = listRenders.count;
    expect(renders).toBeGreaterThan(0);

    for (const more of [' keeps', ' keeps growing', ' keeps growing word by word.']) {
      view.rerender(<MarkdownBody running text={head + more} />);
    }

    expect(view.container.querySelector('p')).toHaveTextContent('The paragraph keeps growing word by word.');
    expect(listRenders.count).toBe(renders);
    expect(view.container.querySelector('ul')).toBe(list);
  });

  it('a footnote reference does not put the reply in one block until its definition arrives', () => {
    const head = '- one\n- two\n\nCited here.[^1] And more';
    const view = render(<MarkdownBody running text={head} />);
    const renders = listRenders.count;
    view.rerender(<MarkdownBody running text={`${head} text`} />);
    expect(listRenders.count).toBe(renders);

    view.rerender(<MarkdownBody running text={`${head} text\n\n[^1]: The note.`} />);
    expect(view.container.querySelector('[data-footnotes]')).toHaveTextContent('The note.');
  });
});
