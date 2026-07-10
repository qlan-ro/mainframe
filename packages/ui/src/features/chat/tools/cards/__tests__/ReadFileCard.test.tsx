/**
 * Behavior tests for ReadFileCard.
 *
 * Each test passes a fixed, concrete props object and asserts the observable
 * DOM output — never re-derives the expected value using the card's own logic.
 *
 * Mocked seams:
 *  - chat-tool-context: useChatId returns undefined (no runtime needed)
 *  - ToolResultExpand: the Tauri bridge fetch is irrelevant here; the mock
 *    renders a stable sentinel so we can assert the truncated branch.
 *
 * Body content lives inside a Radix Collapsible. Because it starts closed,
 * tests that assert on body content first click the trigger to open it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks — must come before the component import
// ---------------------------------------------------------------------------

// useChatId is mutable via mockReturnValue so individual tests can override.
const mockUseChatId = vi.fn<() => string | undefined>(() => undefined);

vi.mock('@/features/chat/tools/chat-tool-context', () => ({
  useChatId: () => mockUseChatId(),
  useOpenFile: () => ({ openFile: () => {}, revealFile: () => {} }),
}));

vi.mock('@/features/chat/tools/ToolResultExpand', () => ({
  ToolResultExpand: () => <div data-testid="tool-result-expand-mock">expand-mock</div>,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ReadFileCard } from '../ReadFileCard';
import { nestedVerticalScrollers } from './_part-fixture';

// ---------------------------------------------------------------------------
// Minimal wrapper so Radix Tooltip doesn't warn
// ---------------------------------------------------------------------------

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// ---------------------------------------------------------------------------
// Shared stub callbacks
// ---------------------------------------------------------------------------

const noop = () => {};
const baseProps = {
  type: 'tool-call' as const,
  toolName: 'Read',
  toolCallId: 'tc-001',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  status: { type: 'complete' as const },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReadFileCard — done state', () => {
  it('renders the "Read" verb in the header', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/home/user/project/src/main.ts', from: 1 }}
          result="const x = 1;\nconst y = 2;"
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('renders the short filename (last two segments) in the header', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/home/user/project/src/main.ts', from: 1 }}
          result="const x = 1;\nconst y = 2;"
          isError={false}
        />
      </Wrap>,
    );
    // shortFilename of '/home/user/project/src/main.ts' → 'src/main.ts'
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('src/main.ts');
  });

  it('shows the line-count meta label matching the actual content', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          // 3 lines
          args={{ file_path: '/a/b/c.ts', from: 5 }}
          result={'line one\nline two\nline three'}
          isError={false}
        />
      </Wrap>,
    );
    // 3 lines → "· 3 lines"
    expect(screen.getByText('· 3 lines')).toBeInTheDocument();
  });

  it('shows "· 1 line" (singular) for a single-line result', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={'only one line'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('· 1 line')).toBeInTheDocument();
  });

  it('renders the result output verbatim, adding no line-number gutter of its own', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 10 }}
          result={'alpha\nbeta'}
          isError={false}
        />
      </Wrap>,
    );
    // Open the collapsible first so the body becomes visible
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    const preview = screen.getByTestId('read-card-code-preview');
    expect(preview).toBeInTheDocument();
    // The output is shown as-is — no gutter numbers are synthesized from `from`.
    expect(preview.textContent).toBe('alpha\nbeta');
  });

  it('renders the card root with data-testid="read-card-root"', () => {
    render(
      <Wrap>
        <ReadFileCard {...baseProps} args={{ file_path: '/a/b/c.ts', from: 1 }} result={'hello'} isError={false} />
      </Wrap>,
    );
    expect(screen.getByTestId('read-card-root')).toBeInTheDocument();
  });

  it('does not nest a vertical scroll container in the code preview (single overflow owner)', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={'alpha\nbeta'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    expect(nestedVerticalScrollers(screen.getByTestId('read-card-root'))).toHaveLength(0);
  });
});

describe('ReadFileCard — pending state (result === undefined)', () => {
  it('renders the header without a meta label when result is absent', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={undefined}
          isError={undefined}
        />
      </Wrap>,
    );
    // No "· N lines" meta when there is no result
    expect(screen.queryByText(/· \d+ line/)).not.toBeInTheDocument();
  });

  it('does not render the code preview when result is absent', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={undefined}
          isError={undefined}
        />
      </Wrap>,
    );
    expect(screen.queryByTestId('read-card-code-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('read-card-content')).not.toBeInTheDocument();
  });

  it('still renders the "Read" verb and file path in the header', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/proj/lib/util.ts', from: 1 }}
          result={undefined}
          isError={undefined}
        />
      </Wrap>,
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('lib/util.ts');
  });
});

describe('ReadFileCard — error state', () => {
  it('renders the error body element', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={'Permission denied: /a/b/c.ts'}
          isError={true}
        />
      </Wrap>,
    );
    // Open the collapsible so the body becomes accessible
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    expect(screen.getByTestId('read-card-error-body')).toBeInTheDocument();
  });

  it('strips <tool_use_error> sentinel tags from the error text', () => {
    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b/c.ts', from: 1 }}
          result={'<tool_use_error>file not found</tool_use_error>'}
          isError={true}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    const errorBody = screen.getByTestId('read-card-error-body');
    // The XML wrapper must be stripped; only the inner text should be present
    expect(errorBody).toHaveTextContent('file not found');
    expect(errorBody).not.toHaveTextContent('<tool_use_error>');
  });

  it('does not render the code preview when isError is true', () => {
    render(
      <Wrap>
        <ReadFileCard {...baseProps} args={{ file_path: '/a/b/c.ts', from: 1 }} result={'oops'} isError={true} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    expect(screen.queryByTestId('read-card-code-preview')).not.toBeInTheDocument();
  });
});

describe('ReadFileCard — cat -n output rendered verbatim (no synthesized gutter)', () => {
  it('shows the cat -n output as-is so line numbers appear exactly once', () => {
    const raw = "1→'use client';\n2→const x = 1;";
    render(
      <Wrap>
        <ReadFileCard {...baseProps} args={{ file_path: '/a/b/c.ts', from: 1 }} result={raw} isError={false} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    const preview = screen.getByTestId('read-card-code-preview');
    // Verbatim: the card adds no gutter, so the only line numbers are the ones
    // already in the result — no duplication.
    expect(preview.textContent).toBe(raw);
  });

  it('renders a partial read verbatim (the result keeps its own line numbers)', () => {
    const raw = '42→line forty-two\n43→line forty-three';
    render(
      <Wrap>
        <ReadFileCard {...baseProps} args={{ file_path: '/a/b/c.ts', from: 100 }} result={raw} isError={false} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    const preview = screen.getByTestId('read-card-code-preview');
    // The result's own numbers (42/43) are shown; the `from` arg is not used to
    // synthesize a gutter.
    expect(preview.textContent).toBe(raw);
  });
});

describe('ReadFileCard — truncated result', () => {
  it('falls back to CodePreview with truncated content when chatId is absent', () => {
    // mockUseChatId returns undefined by default. The condition
    // (truncated && chatId) is false, so the card renders CodePreview using the
    // .content field rather than ToolResultExpand.
    const truncatedResult = {
      content: 'first 200 chars...',
      truncated: true as const,
      fullBytes: 10240,
    };

    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b.ts', from: 1 }}
          result={truncatedResult}
          isError={false}
        />
      </Wrap>,
    );
    // Open the collapsible so the body becomes visible
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    const preview = screen.getByTestId('read-card-code-preview');
    expect(preview).toHaveTextContent('first 200 chars...');
  });

  it('renders ToolResultExpand when result is truncated and chatId is present', () => {
    // Make useChatId return a real chatId for this one test so the card takes
    // the ToolResultExpand branch.
    mockUseChatId.mockReturnValueOnce('chat-abc');

    const truncatedResult = {
      content: 'preview text',
      truncated: true as const,
      fullBytes: 5120,
    };

    render(
      <Wrap>
        <ReadFileCard
          {...baseProps}
          args={{ file_path: '/a/b.ts', from: 1 }}
          result={truncatedResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('read-card-trigger'));
    expect(screen.getByTestId('tool-result-expand-mock')).toBeInTheDocument();
  });
});
