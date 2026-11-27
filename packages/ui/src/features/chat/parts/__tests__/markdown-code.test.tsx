import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MarkdownCodeBlock, PLAIN_CODE_MAX_CHARS, PLAIN_CODE_MAX_LINES } from '../markdown-code';

afterEach(() => vi.restoreAllMocks());

describe('MarkdownCodeBlock (shadcn Code Block)', () => {
  it('names the language as written, and "text" for an untagged fence', () => {
    const { rerender } = render(<MarkdownCodeBlock code="const x = 1;" language="ts" />);
    expect(screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-title"]')).toHaveTextContent(
      'ts',
    );
    rerender(<MarkdownCodeBlock code="plain" />);
    expect(screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-title"]')).toHaveTextContent(
      'text',
    );
  });

  it('renders one numbered line per line of code, blank lines included', () => {
    render(<MarkdownCodeBlock code={'line one\n\nline three'} />);
    const content = screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-content"]')!;
    expect(content).toHaveAttribute('data-numbered', 'true');
    const lines = [...content.querySelectorAll('[data-slot="code-block-line"]')].map((l) => l.textContent);
    expect(lines).toEqual(['line one', '\n', 'line three']);
  });

  it('keeps a block at the line limit numbered and per-line', () => {
    const code = Array.from({ length: PLAIN_CODE_MAX_LINES }, (_, i) => `row ${i}`).join('\n');
    render(<MarkdownCodeBlock code={code} language="ts" />);
    const content = screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-content"]')!;
    expect(content).not.toHaveAttribute('data-plain');
    expect(content.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(PLAIN_CODE_MAX_LINES);
  });

  it('renders a block over the line limit as plain text, with no per-line elements', () => {
    const code = Array.from({ length: PLAIN_CODE_MAX_LINES + 1 }, (_, i) => `row ${i}`).join('\n');
    render(<MarkdownCodeBlock code={code} language="ts" />);
    const content = screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-content"]')!;
    expect(content).toHaveAttribute('data-plain');
    expect(content).not.toHaveAttribute('data-numbered');
    expect(content.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(0);
    expect(content.textContent).toBe(code);
  });

  it('renders a block over the size limit as plain text even on one line', () => {
    const code = 'x'.repeat(PLAIN_CODE_MAX_CHARS + 1);
    render(<MarkdownCodeBlock code={code} language="ts" />);
    const content = screen.getByTestId('chat-code-block').querySelector('[data-slot="code-block-content"]')!;
    expect(content).toHaveAttribute('data-plain');
    expect(content.textContent).toBe(code);
  });

  it('does not tokenize a large block', async () => {
    const shiki = await import('@/lib/shiki-highlighter');
    const spy = vi.spyOn(shiki, 'getShikiHighlighter');
    const code = Array.from({ length: PLAIN_CODE_MAX_LINES + 1 }, () => 'const a = 1;').join('\n');
    render(<MarkdownCodeBlock code={code} language="ts" />);
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows a visible "Copy" label and copies the code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MarkdownCodeBlock code="echo hi" language="bash" />);
    const button = screen.getByTestId('chat-code-copy');
    expect(button).toHaveTextContent('Copy');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith('echo hi');
    expect(button).toHaveTextContent('Copied');
  });
});
