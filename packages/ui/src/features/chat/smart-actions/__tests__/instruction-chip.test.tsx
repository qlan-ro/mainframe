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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Skill } from '@qlan-ro/mainframe-types';
// ReviewCommentCard renders a v2 `Hint`, which the v1 provider does not satisfy.
import { TooltipProvider } from '@/components/ui/tooltip';

function skill(name: string): Skill {
  return {
    id: name,
    adapterId: 'claude',
    name,
    displayName: name,
    description: '',
    scope: 'global',
    filePath: `/skills/${name}.md`,
    content: '',
    invocationName: name,
  };
}

const CATALOG: Skill[] = [skill('todo-pipeline'), skill('domain-modeling')];

// Mutable so the catalog-loading case can be driven; reset in beforeEach.
let catalog: Skill[] = CATALOG;
let catalogLoading = false;

vi.mock('@/features/skills/use-chat-skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/skills/use-chat-skills')>();
  return { ...actual, useChatSkills: () => ({ skills: catalog, agents: [], loading: catalogLoading }) };
});

vi.mock('../use-instruction-actions', () => ({
  useInstructionActions: () => ({ append: vi.fn(), runInNewSession: vi.fn() }),
}));

import { MarkdownText, markdownComponents } from '../../parts/markdown-text';
import { remarkSmartActions } from '../remark-smart-actions';
import { PlanBubble } from '../../messages/PlanBubble';
import { ReviewCommentCard } from '../../messages/ReviewCommentCard';

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

beforeEach(() => {
  catalog = CATALOG;
  catalogLoading = false;
});

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
    const { container } = renderMarkdown('```sh\n/unknown-name run\n```');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(screen.getByTestId('chat-code-copy')).toBeInTheDocument();
    // Native header AND native body: the highlighter is not suppressed.
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('/unknown-name run');
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

  it('chips a sentence-final token and leaves the period outside the chip', () => {
    const { container } = renderMarkdown('Start with /domain-modeling.');

    const chip = screen.getByTestId('smart-action-instruction-append').closest('[data-smart-action-token]');
    expect(chip!.getAttribute('data-smart-action-token')).toBe('/domain-modeling');
    expect(chip!.textContent).toBe('/domain-modeling');
    expect(container.textContent).toBe('Start with /domain-modeling.');
  });

  it('never chips a path-like token', () => {
    const { container } = renderMarkdown('Run /usr/bin/env node');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-token]')).toBeNull();
    expect(container.textContent).toBe('Run /usr/bin/env node');
  });

  it('never chips a file reference', () => {
    const { container } = renderMarkdown('See /README.md for setup');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.textContent).toBe('See /README.md for setup');
  });

  it('leaves an inline code span whose name holds a disallowed character as plain inline code', () => {
    const { container } = renderMarkdown('Try `/domain$modeling` next');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('code')!.textContent).toBe('/domain$modeling');
    expect(container.textContent).toBe('Try /domain$modeling next');
  });

  it('renders no chip while the skills catalog is still loading', () => {
    catalogLoading = true;
    const { container } = renderMarkdown('Run /domain-modeling first');

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-token]')).toBeNull();
    expect(container.textContent).toBe('Run /domain-modeling first');
  });

  it('chips both instructions in one paragraph, each carrying its own token', () => {
    renderMarkdown('First /domain-modeling then /todo-pipeline');

    const buttons = screen.getAllByTestId('smart-action-instruction-append');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.closest('[data-smart-action-token]')!.getAttribute('data-smart-action-token')).toBe(
      '/domain-modeling',
    );
    expect(buttons[1]!.closest('[data-smart-action-token]')!.getAttribute('data-smart-action-token')).toBe(
      '/todo-pipeline',
    );
  });
});

describe('instruction chip — controls', () => {
  it('names both buttons for assistive tech', () => {
    renderMarkdown('Run /domain-modeling first');

    expect(screen.getByTestId('smart-action-instruction-append')).toHaveAttribute('aria-label', 'Add to composer');
    expect(screen.getByTestId('smart-action-instruction-new-session')).toHaveAttribute(
      'aria-label',
      'Run in a new session',
    );
  });
});

describe('instruction chip — streaming settle', () => {
  it('chips the token once the streamed text completes the skill name', async () => {
    const { rerender, container } = render(
      <TooltipProvider>
        <TextMessagePartProvider text="Run /domain-mod" isRunning={false}>
          <Markdown />
        </TextMessagePartProvider>
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.textContent).toBe('Run /domain-mod');

    rerender(
      <TooltipProvider>
        <TextMessagePartProvider text="Run /domain-modeling" isRunning={false}>
          <Markdown />
        </TextMessagePartProvider>
      </TooltipProvider>,
    );

    // The primitive reveals appended text over animation frames, so the chip
    // arrives a frame or two after the rerender — not synchronously.
    const chip = (await screen.findByTestId('smart-action-instruction-append')).closest('[data-smart-action-token]');
    expect(chip!.getAttribute('data-smart-action-token')).toBe('/domain-modeling');
    expect(container.textContent).toBe('Run /domain-modeling');
  });
});

describe('instruction chip — surfaces outside MarkdownText', () => {
  it('renders no chip inside a PlanBubble', () => {
    const { container } = render(<PlanBubble plan={'Start with /domain-modeling.\n\n`/todo-pipeline run`'} />);

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-token]')).toBeNull();
    expect(container.textContent).toContain('Start with /domain-modeling.');
    expect(container.textContent).toContain('/todo-pipeline run');
  });

  it('renders no chip inside a ReviewCommentCard', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewCommentCard
          review={{
            file: '/Users/x/app/globals.css',
            comments: [{ start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'Run /domain-modeling on this' }],
          }}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-token]')).toBeNull();
    expect(container.textContent).toContain('Run /domain-modeling on this');
  });

  it('renders no chip for the shared component map without the MarkdownText provider', () => {
    // UserMessage reuses `markdownComponents` outside `MarkdownText`. Even with
    // the marker plugin attached, the provider — not the plugin — is the gate.
    const { container } = render(
      <TooltipProvider>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkSmartActions]} components={markdownComponents}>
          {'Run /domain-modeling and `/todo-pipeline run`'}
        </ReactMarkdown>
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('smart-action-instruction-append')).toBeNull();
    expect(container.querySelector('[data-smart-action-token]')).toBeNull();
    expect(container.textContent).toBe('Run /domain-modeling and /todo-pipeline run');
  });
});
