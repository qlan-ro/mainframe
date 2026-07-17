/**
 * BashCard — behavior tests.
 *
 * Strategy:
 *  - vi.mock 'chat-tool-context' so useChatId returns undefined (no full
 *    runtime required; cards render fine without a chatId).
 *  - vi.mock 'ToolResultExpand' so Tauri bridge fetch is not exercised.
 *  - Wrap renders in TooltipProvider (Radix Tooltip requires it).
 *  - Assert hardcoded expected values; never recompute card logic in tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// useChatId returns a value so the ToolResultExpand path (truncated &&
// chatId && toolCallId) can be exercised in the truncated-result tests.
vi.mock('@/features/chat/tools/chat-tool-context', () => ({
  useChatId: () => 'chat-1',
  useOpenFile: () => ({ openFile: () => {}, revealFile: () => {} }),
}));

vi.mock('@/features/chat/tools/ToolResultExpand', () => ({
  ToolResultExpand: () => <div data-testid="tool-result-expand-mock">expand-mock</div>,
}));

// ---------------------------------------------------------------------------
// Component under test (imported after mocks are registered)
// ---------------------------------------------------------------------------

import { BashCard } from '../BashCard';
import { nestedVerticalScrollers } from './_part-fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

function makePart(overrides: {
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  toolCallId?: string;
}): ToolCallMessagePartProps {
  return {
    type: 'tool-call' as const,
    toolName: 'Bash',
    toolCallId: overrides.toolCallId ?? 'tc-bash-1',
    args: (overrides.args ?? { command: 'echo hello' }) as ToolCallMessagePartProps['args'],
    argsText: '',
    result: overrides.result,
    isError: overrides.isError,
    status: { type: 'complete' as const },
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
  };
}

function renderCard(props: ReturnType<typeof makePart>) {
  return render(
    <TooltipProvider>
      <BashCard {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BashCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Header: command text ---

  it('shows the command from args.command in the header', () => {
    renderCard(makePart({ args: { command: 'git status' } }));
    expect(screen.getByTestId('chat-bash-command')).toHaveTextContent('git status');
  });

  it('falls back to args.input when args.command is absent', () => {
    renderCard(makePart({ args: { input: 'npm test' } }));
    expect(screen.getByTestId('chat-bash-command')).toHaveTextContent('npm test');
  });

  it('renders an empty command span when neither command nor input is provided', () => {
    renderCard(makePart({ args: {} }));
    // data-testid exists and contains empty/whitespace text
    expect(screen.getByTestId('chat-bash-command')).toBeInTheDocument();
  });

  // --- Header: optional description sub-header ---

  it('renders the description sub-header when args.description is set', () => {
    renderCard(
      makePart({
        args: { command: 'pnpm test', description: 'Run the test suite' },
      }),
    );
    expect(screen.getByTestId('chat-bash-description')).toHaveTextContent('Run the test suite');
  });

  it('does not render the description sub-header when args.description is absent', () => {
    renderCard(makePart({ args: { command: 'echo hi' } }));
    expect(screen.queryByTestId('chat-bash-description')).not.toBeInTheDocument();
  });

  // --- Status dot states ---

  it('renders a pulsing status dot while result is pending (result === undefined)', () => {
    renderCard(makePart({ args: { command: 'sleep 1' }, result: undefined }));
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does NOT render a pulsing dot once the result is resolved', () => {
    renderCard(makePart({ args: { command: 'echo ok' }, result: 'ok', isError: false }));
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  // --- Collapsible: trigger disabled when no output ---

  it('renders the CollapsibleTrigger with data-testid="chat-bash-trigger"', () => {
    renderCard(makePart({ args: { command: 'ls' } }));
    expect(screen.getByTestId('chat-bash-trigger')).toBeInTheDocument();
  });

  it('trigger is disabled when the command finished with no output', () => {
    // result === '' → completed, but nothing to show and no longer running.
    renderCard(makePart({ args: { command: 'touch f' }, result: '' }));
    const trigger = screen.getByTestId('chat-bash-trigger');
    expect(trigger).toBeDisabled();
  });

  it('trigger is ENABLED while the command is still running (result === undefined) (#208)', () => {
    renderCard(makePart({ args: { command: 'sleep 1' }, result: undefined }));
    const trigger = screen.getByTestId('chat-bash-trigger');
    expect(trigger).not.toBeDisabled();
  });

  it('expands to show the running command in the output body while result is pending (#208)', () => {
    renderCard(makePart({ args: { command: 'pnpm build' }, result: undefined }));
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('pnpm build');
  });

  // --- Output body content ---

  it('does not show the output body when result is undefined', () => {
    renderCard(makePart({ args: { command: 'ls' }, result: undefined }));
    expect(screen.queryByTestId('chat-bash-output')).not.toBeInTheDocument();
  });

  it('expands to show terminal output after clicking the trigger', () => {
    renderCard(
      makePart({
        args: { command: 'echo hello' },
        result: 'hello\nexit 0',
        isError: false,
      }),
    );
    const trigger = screen.getByTestId('chat-bash-trigger');
    fireEvent.click(trigger);
    const output = screen.getByTestId('chat-bash-output');
    expect(output).toHaveTextContent('hello');
  });

  it('does not nest a vertical scroll container in the terminal body (single overflow owner)', () => {
    renderCard(makePart({ args: { command: 'echo hi' }, result: 'hi\nexit 0', isError: false }));
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    expect(nestedVerticalScrollers(screen.getByTestId('chat-bash-card'))).toHaveLength(0);
  });

  it('shows the command as a prompt line inside the output body', () => {
    renderCard(
      makePart({
        args: { command: 'echo hello' },
        result: 'hello',
        isError: false,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    // Prompt line: "$ " + command
    const output = screen.getByTestId('chat-bash-output');
    expect(output).toHaveTextContent('echo hello');
  });

  it('renders multi-line output with each line in the body', () => {
    renderCard(
      makePart({
        args: { command: 'ls' },
        result: 'file1.ts\nfile2.ts\nfile3.ts',
        isError: false,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    const output = screen.getByTestId('chat-bash-output');
    expect(output).toHaveTextContent('file1.ts');
    expect(output).toHaveTextContent('file2.ts');
    expect(output).toHaveTextContent('file3.ts');
  });

  it('strips <tool_use_error> XML sentinel tags from the output text', () => {
    renderCard(
      makePart({
        args: { command: 'bad-cmd' },
        result: '<tool_use_error>command not found</tool_use_error>',
        isError: true,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    const output = screen.getByTestId('chat-bash-output');
    expect(output).toHaveTextContent('command not found');
    expect(output).not.toHaveTextContent('<tool_use_error>');
  });

  // --- Error state ---

  it('does NOT show the error border when isError is false', () => {
    renderCard(makePart({ args: { command: 'echo ok' }, result: 'ok', isError: false }));
    // No border-destructive on the card root
    const card = screen.getByTestId('chat-bash-card');
    expect(card).not.toHaveClass('border-destructive');
  });

  // --- Truncated result: ToolResultExpand mock shown ---

  it('renders the ToolResultExpand stub when result is a truncated object', () => {
    renderCard(
      makePart({
        args: { command: 'cat large-file.txt' },
        result: { content: 'partial output...', truncated: true, fullBytes: 102400 },
        isError: false,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    expect(screen.getByTestId('tool-result-expand-mock')).toBeInTheDocument();
  });

  it('does NOT render the raw output <pre> when result is a truncated object', () => {
    renderCard(
      makePart({
        args: { command: 'cat big.txt' },
        result: { content: 'partial', truncated: true, fullBytes: 50000 },
        isError: false,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-bash-trigger'));
    expect(screen.queryByTestId('chat-bash-output')).not.toBeInTheDocument();
  });
});
