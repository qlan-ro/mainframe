import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MarkdownCodeBlock } from '../markdown-code';

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
