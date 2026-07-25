/**
 * Characterization of the fence seam map (plan decision 8).
 *
 * The four instruction seams are decided, not discovered, here: `CodeHeader` is
 * the single slot both fence flavors call, so it is the only one that emits the
 * block chip; the two body slots (`Code`'s block branch for a language-less
 * fence, `SyntaxHighlighter` for a language-tagged one) return null. These
 * tests pin that through the real `MarkdownText` pipeline — if a flavor
 * deviates, the seam map is wrong for the installed `@assistant-ui/*`.
 *
 * Mocked seams: the skills catalog (chip gating) and the chip's actions, which
 * need the assistant runtime + daemon port providers this test does not mount.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const CATALOG: Skill[] = [
  {
    id: 'todo-pipeline',
    adapterId: 'claude',
    name: 'todo-pipeline',
    displayName: 'Todo pipeline',
    description: '',
    scope: 'global',
    filePath: '/skills/todo-pipeline.md',
    content: '',
    invocationName: 'todo-pipeline',
  },
];

vi.mock('@/features/skills/use-chat-skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/skills/use-chat-skills')>();
  return { ...actual, useChatSkills: () => ({ skills: CATALOG, agents: [], loading: false }) };
});

vi.mock('../use-instruction-actions', () => ({
  useInstructionActions: () => ({ append: vi.fn(), runInNewSession: vi.fn() }),
}));

import { MarkdownText } from '../../parts/markdown-text';

const Markdown = MarkdownText as unknown as React.FC;

function renderMarkdown(text: string) {
  return render(
    <TooltipProvider>
      <TextMessagePartProvider text={text} isRunning={false}>
        <Markdown />
      </TextMessagePartProvider>
    </TooltipProvider>,
  );
}

describe('instruction chip — fence seams', () => {
  it('renders exactly one block chip for a language-less single-instruction fence', () => {
    const { container } = renderMarkdown('```\n/todo-pipeline run\n```');

    expect(screen.getAllByTestId('smart-action-instruction-append')).toHaveLength(1);
    expect(screen.getAllByTestId('smart-action-instruction-new-session')).toHaveLength(1);
    expect(screen.queryByTestId('chat-code-copy')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain('/todo-pipeline run');
  });

  it('renders exactly one block chip for a language-tagged single-instruction fence', () => {
    const { container } = renderMarkdown('```sh\n/todo-pipeline run\n```');

    expect(screen.getAllByTestId('smart-action-instruction-append')).toHaveLength(1);
    expect(screen.queryByTestId('chat-code-copy')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain('/todo-pipeline run');
  });

  it('leaves a fence whose instruction is not in the catalog on the native path', () => {
    renderMarkdown('```sh\n/unknown-name run\n```');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(screen.getByTestId('chat-code-copy')).toBeInTheDocument();
  });

  it('leaves a multi-line fence on the native path', () => {
    renderMarkdown('```sh\n/todo-pipeline run\necho done\n```');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(screen.getByTestId('chat-code-copy')).toBeInTheDocument();
  });
});

describe('instruction chip — prose and inline code', () => {
  it('chips a bare token in prose and keeps the surrounding text', () => {
    const { container } = renderMarkdown('Run /todo-pipeline first');

    const chip = screen.getByTestId('smart-action-instruction-append').closest('[data-smart-action-token]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-smart-action-token')).toBe('/todo-pipeline');
    expect(container.textContent).toBe('Run /todo-pipeline first');
  });

  it('chips an inline code span holding one instruction with arguments', () => {
    renderMarkdown('Try `/todo-pipeline run` next');

    const chip = screen.getByTestId('smart-action-instruction-append').closest('[data-smart-action-token]');
    expect(chip!.getAttribute('data-smart-action-token')).toBe('/todo-pipeline');
    expect(chip!.textContent).toContain('/todo-pipeline run');
  });

  it('renders an unresolved token as plain text with no wrapper element', () => {
    const { container } = renderMarkdown('Run /unknown-name first');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-instruction]')).toBeNull();
    expect(container.textContent).toBe('Run /unknown-name first');
  });

  it('never chips a token inside a link', () => {
    renderMarkdown('[/todo-pipeline](https://example.com)');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
  });
});
