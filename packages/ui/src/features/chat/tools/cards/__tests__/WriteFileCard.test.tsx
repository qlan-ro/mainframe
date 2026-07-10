/**
 * WriteFileCard — behavior tests.
 *
 * Strategy:
 *  - vi.mock '@assistant-ui/react' to stub useAuiState so useChatId returns
 *    undefined (safe — the card renders fine without a chatId).
 *  - Wrap renders in TooltipProvider (Radix Tooltip requires it via
 *    ClickableFilePath).
 *  - Assert hardcoded expected values; never recompute the card's own logic.
 *
 * Key behaviors:
 *  - Collapsed by default (defaultOpen=false) — body hidden until trigger click.
 *  - Header: "Write" verb + shortened file path + optional +N pill + StatusDot.
 *  - Body: DiffFromPatch when structuredPatch present; AllAddLines otherwise.
 *  - Error footer: error text (or ToolResultExpand) when isError=true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';

// Stub useAuiState so useChatExtras → useChatId returns undefined without a
// full AssistantRuntime.
vi.mock('@assistant-ui/react', () => ({
  useAuiState: () => undefined,
}));

import { WriteFileCard } from '../WriteFileCard';
import { nestedVerticalScrollers } from './_part-fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePart(overrides: {
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  toolCallId?: string;
}): ToolCallMessagePartProps {
  return {
    type: 'tool-call' as const,
    toolName: 'Write',
    toolCallId: overrides.toolCallId ?? 'tc-write-1',
    args: (overrides.args ?? { file_path: 'src/new.ts', content: '' }) as ToolCallMessagePartProps['args'],
    argsText: '',
    result: overrides.result,
    isError: overrides.isError,
    status: { type: 'complete' as const },
    messages: [],
    addResult: () => {},
    resume: () => {},
    respondToApproval: () => {},
  };
}

function renderCard(props: ReturnType<typeof makePart>) {
  return render(
    <TooltipProvider>
      <WriteFileCard {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WriteFileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Root element ---

  it('renders the card root with data-testid="chat-write-card"', () => {
    renderCard(makePart({ args: { file_path: 'src/new.ts', content: '' } }));
    expect(screen.getByTestId('chat-write-card')).toBeInTheDocument();
  });

  // --- Header always visible ---

  it('renders the "Write" verb label in the header', () => {
    renderCard(makePart({ args: { file_path: 'src/new.ts', content: '' } }));
    expect(screen.getByText('Write')).toBeInTheDocument();
  });

  it('shows only the last two path segments as the file path badge', () => {
    renderCard(
      makePart({
        args: { file_path: '/home/user/project/src/lib/config.ts', content: '' },
      }),
    );
    // shortFilename('/home/user/project/src/lib/config.ts') → 'lib/config.ts'
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('lib/config.ts');
  });

  it('shows just the filename when the path has only one segment', () => {
    renderCard(
      makePart({
        args: { file_path: 'index.ts', content: '' },
      }),
    );
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('index.ts');
  });

  // --- Status dot states ---

  it('renders a pulsing status dot while result is pending (result=undefined)', () => {
    renderCard(makePart({ args: { file_path: 'src/new.ts', content: 'line1' }, result: undefined }));
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does NOT render an animate-pulse dot once the result is resolved', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'line1' },
        result: 'OK',
        isError: false,
      }),
    );
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  // --- +N pill from structuredPatch ---

  it('shows +3 pill when result carries a structuredPatch with 3 added lines', () => {
    const structuredResult = {
      content: 'File written successfully.',
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 3,
          lines: ['+line one', '+line two', '+line three'],
        },
      ],
    };

    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'line one\nline two\nline three' },
        result: structuredResult,
        isError: false,
      }),
    );

    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('shows no +N pill when there is no structuredPatch', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'some content' },
        result: 'OK',
        isError: false,
      }),
    );
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  // --- Collapsed by default — body NOT visible until trigger clicked ---

  it('hides body content on initial render (collapsed by default)', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'hello world' },
        result: 'OK',
        isError: false,
      }),
    );
    // "hello world" is inside the collapsed body — should not be visible
    expect(screen.queryByText('hello world')).not.toBeInTheDocument();
  });

  it('reveals AllAddLines body after clicking the trigger to expand', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'hello world' },
        result: 'OK',
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    // AllAddLines renders each content line — 'hello world' is the only line
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('does not nest a vertical scroll container in the expanded body (single overflow owner)', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'hello world' },
        result: 'OK',
        isError: false,
      }),
    );
    await userEvent.click(screen.getByTestId('chat-write-trigger'));
    expect(nestedVerticalScrollers(screen.getByTestId('chat-write-card'))).toHaveLength(0);
  });

  it('collapses body again when trigger is clicked a second time', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/new.ts', content: 'alpha beta' },
        result: 'OK',
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');

    // Expand
    await userEvent.click(trigger);
    expect(screen.getByText('alpha beta')).toBeInTheDocument();

    // Collapse
    await userEvent.click(trigger);
    expect(screen.queryByText('alpha beta')).not.toBeInTheDocument();
  });

  // --- Body: DiffFromPatch when structuredPatch present ---

  it('renders diff lines from structuredPatch in the body after expanding', async () => {
    const structuredResult = {
      content: 'OK',
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: ['+export function greet() {', '+  return "hello";'],
        },
      ],
    };

    renderCard(
      makePart({
        args: { file_path: 'src/greet.ts', content: 'export function greet() {\n  return "hello";' },
        result: structuredResult,
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.getByText('export function greet() {')).toBeInTheDocument();
    // Leading whitespace in `  return "hello";` is preserved in the DOM but
    // getByText normalizes text by default — use a substring regex instead.
    expect(screen.getByText(/return "hello";/)).toBeInTheDocument();
  });

  // --- Body: AllAddLines when no structuredPatch ---

  it('renders each content line as an add row (AllAddLines) when no structuredPatch', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/data.ts', content: 'line A\nline B\nline C' },
        result: 'OK',
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.getByText('line A')).toBeInTheDocument();
    expect(screen.getByText('line B')).toBeInTheDocument();
    expect(screen.getByText('line C')).toBeInTheDocument();
  });

  it('renders an empty AllAddLines view for empty content without errors', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/empty.ts', content: '' },
        result: 'OK',
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    // Empty content renders one empty line row — no error thrown
    expect(screen.getByTestId('chat-write-card')).toBeInTheDocument();
  });

  // --- Error state ---

  it('shows error text in the footer when isError=true (requires expanding)', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/protected.ts', content: 'data' },
        result: 'Permission denied',
        isError: true,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.getByTestId('chat-write-error-text')).toHaveTextContent('Permission denied');
  });

  it('strips <tool_use_error> XML sentinel from the error footer text', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/protected.ts', content: 'data' },
        result: '<tool_use_error>Disk full</tool_use_error>',
        isError: true,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.getByTestId('chat-write-error-text')).toHaveTextContent('Disk full');
    expect(screen.queryByText(/<tool_use_error>/)).not.toBeInTheDocument();
  });

  it('does NOT show error footer when isError=false even if result is a string', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/ok.ts', content: 'data' },
        result: 'some output text',
        isError: false,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.queryByTestId('chat-write-error-text')).not.toBeInTheDocument();
  });

  it('does NOT show error footer while result is pending (undefined)', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/pending.ts', content: 'data' },
        result: undefined,
        isError: undefined,
      }),
    );

    const trigger = screen.getByTestId('chat-write-trigger');
    await userEvent.click(trigger);

    expect(screen.queryByTestId('chat-write-error-text')).not.toBeInTheDocument();
  });
});
