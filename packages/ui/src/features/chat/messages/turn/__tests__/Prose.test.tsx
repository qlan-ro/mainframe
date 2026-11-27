/** Markdown outside a message part is drawn as a reply's is (T1b: one dialect). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Prose } from '../Prose';

// Unhighlighted lines: the highlighter is not what these tests are about.
vi.mock('@/lib/shiki-tokens', () => ({ useShikiTokens: () => null, TokenSpans: () => null }));

const codeLines = () =>
  [...screen.getByTestId('chat-code-block').querySelectorAll('[data-slot="code-block-line"]')].map(
    (line) => line.textContent,
  );

const show = (text: string) =>
  render(
    <TooltipProvider>
      <Prose text={text} />
    </TooltipProvider>,
  );

it('draws fenced code as a block, with its language, its lines and Copy', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  show('Run:\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n');
  const block = screen.getByTestId('chat-code-block');
  expect(block.querySelector('pre')).not.toBeNull();
  expect(codeLines()).toEqual(['const a = 1;', 'const b = 2;']);
  expect(screen.getByText('ts')).toBeVisible();
  expect(block.querySelector('.aui-md-inline-code')).toBeNull();
  fireEvent.click(screen.getByTestId('chat-code-copy'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('const b = 2;')));
});

it('draws a fence without a language as a block too', () => {
  show('```\none\ntwo\n```');
  expect(codeLines()).toEqual(['one', 'two']);
  expect(screen.getByText('text')).toBeVisible();
});

it('keeps inline code inline, and a single line break as one', () => {
  const { container } = show('Use `rg`\nthen stop');
  expect(screen.getByText('rg').tagName).toBe('CODE');
  expect(screen.queryByTestId('chat-code-block')).toBeNull();
  expect(container.querySelector('br')).not.toBeNull();
});
