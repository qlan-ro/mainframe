/**
 * EditFileCard — behavior tests.
 *
 * Strategy:
 *  - vi.mock '@assistant-ui/react' to stub useAuiState so useChatId returns
 *    undefined (safe — cards render fine without a chatId).
 *  - Wrap renders in TooltipProvider (Radix Tooltip requires it).
 *  - Assert hardcoded expected values; never recompute the card's own diff math.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';

// Mock useAuiState so useChatExtras → useChatId returns undefined without a
// full AssistantRuntime.
vi.mock('@assistant-ui/react', () => ({
  useAuiState: () => undefined,
}));

// Mock the surface-intent emitter so we can assert on what the card emits
// without wiring up a full store subscription.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
  onSurfaceIntent: vi.fn(),
}));

import { EditFileCard } from '../EditFileCard';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { nestedVerticalScrollers } from './_part-fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum valid ToolCallMessagePartProps for EditFileCard. */
function makePart(overrides: {
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  toolCallId?: string;
}): ToolCallMessagePartProps {
  return {
    type: 'tool-call' as const,
    toolName: 'Edit',
    toolCallId: overrides.toolCallId ?? 'tc-1',
    args: (overrides.args ?? {
      file_path: 'src/app.ts',
      old_string: '',
      new_string: '',
    }) as ToolCallMessagePartProps['args'],
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
      <EditFileCard {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EditFileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Header always visible (defaultOpen=true, Collapsible expanded on mount) ---

  it('renders the "Edit" verb label in the header', () => {
    renderCard(makePart({ args: { file_path: 'src/app.ts', old_string: '', new_string: '' } }));
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('shows only the last two path segments as the file path badge', () => {
    renderCard(
      makePart({
        args: {
          file_path: '/home/user/project/src/utils/helpers.ts',
          old_string: '',
          new_string: '',
        },
      }),
    );
    // shortFilename('/home/user/project/src/utils/helpers.ts') → 'utils/helpers.ts'
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('utils/helpers.ts');
  });

  it('shows just the filename when the path has only one segment', () => {
    renderCard(
      makePart({
        args: { file_path: 'README.md', old_string: '', new_string: '' },
      }),
    );
    expect(screen.getByTestId('tool-card-file-path')).toHaveTextContent('README.md');
  });

  it('renders the open-in-diff icon button in the header', () => {
    renderCard(makePart({ args: { file_path: 'src/index.ts', old_string: '', new_string: '' } }));
    expect(screen.getByTestId('chat-edit-open-diff')).toBeInTheDocument();
  });

  // --- Status dot states ---

  it('renders a pulsing status dot while result is pending (result=undefined)', () => {
    renderCard(makePart({ args: { file_path: 'a.ts', old_string: '', new_string: '' }, result: undefined }));
    // StatusDot renders animate-pulse span only when result === undefined
    const pulseDot = document.querySelector('.animate-pulse');
    expect(pulseDot).toBeInTheDocument();
  });

  it('does NOT render an animate-pulse dot once the result is resolved', () => {
    renderCard(
      makePart({
        args: { file_path: 'a.ts', old_string: 'old', new_string: 'new' },
        result: 'OK',
        isError: false,
      }),
    );
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  // --- Diff stat pills from a structured patch ---

  it('shows +2 / −1 stat pills when result carries a structuredPatch with those counts', () => {
    const structuredResult = {
      content: 'File edited successfully.',
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: ['-old line', '+new line A', '+new line B'],
        },
      ],
    };

    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'old line', new_string: 'new line A\nnew line B' },
        result: structuredResult,
        isError: false,
      }),
    );

    // +2 added, -1 removed — hardcoded from the fixture above
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
  });

  it('shows no stat pills when there is no structuredPatch and no old/new strings', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/empty.ts', old_string: '', new_string: '' },
        result: 'OK',
        isError: false,
      }),
    );
    // No +N or −N pill should appear
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^−\d/)).not.toBeInTheDocument();
  });

  // --- Diff body visible (defaultOpen=true) ---

  it('renders diff lines from the structuredPatch in the body', () => {
    const structuredResult = {
      content: 'OK',
      structuredPatch: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 1,
          lines: ['-const x = 1;', '+const x = 42;'],
        },
      ],
    };

    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' },
        result: structuredResult,
        isError: false,
      }),
    );

    // Card is defaultOpen — body should be visible without any interaction
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('const x = 42;')).toBeInTheDocument();
  });

  it('renders fallback diff (old/new strings) when result has no structuredPatch', () => {
    renderCard(
      makePart({
        args: {
          file_path: 'src/app.ts',
          old_string: 'hello world',
          new_string: 'hello universe',
        },
        result: 'OK',
        isError: false,
      }),
    );

    // DiffFallback renders each line as a del/add row
    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText('hello universe')).toBeInTheDocument();
  });

  // --- Error state ---

  it('shows error text in the body footer when isError=true with a plain string result', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/bad.ts', old_string: 'old', new_string: 'new' },
        result: 'File not found',
        isError: true,
      }),
    );

    expect(screen.getByTestId('chat-edit-error-text')).toHaveTextContent('File not found');
  });

  it('strips <tool_use_error> XML sentinel from the error text', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/bad.ts', old_string: 'old', new_string: 'new' },
        result: '<tool_use_error>Permission denied</tool_use_error>',
        isError: true,
      }),
    );

    expect(screen.getByTestId('chat-edit-error-text')).toHaveTextContent('Permission denied');
    expect(screen.queryByText(/<tool_use_error>/)).not.toBeInTheDocument();
  });

  it('does NOT show error footer when isError=false even if result is a string', () => {
    renderCard(
      makePart({
        args: { file_path: 'src/ok.ts', old_string: 'a', new_string: 'b' },
        result: 'some output',
        isError: false,
      }),
    );

    expect(screen.queryByTestId('chat-edit-error-text')).not.toBeInTheDocument();
  });

  // --- Collapsible toggle ---

  it('collapses and hides the body when the header trigger is clicked', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'alpha', new_string: 'beta' },
        result: 'OK',
        isError: false,
      }),
    );

    // Initially open — diff content visible
    expect(screen.getByText('alpha')).toBeInTheDocument();

    const trigger = screen.getByTestId('chat-edit-trigger');
    await userEvent.click(trigger);

    // After collapsing, the lines should no longer be visible
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  // --- Root element ---

  it('renders the card root with data-testid="chat-edit-card"', () => {
    renderCard(makePart({ args: { file_path: 'f.ts', old_string: '', new_string: '' } }));
    expect(screen.getByTestId('chat-edit-card')).toBeInTheDocument();
  });

  // --- Single overflow owner (todo #198: no double scrollbar) ---

  it('does not nest a vertical scroll container in the diff body (single overflow owner)', () => {
    const structuredResult = {
      content: 'OK',
      structuredPatch: [
        { oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, lines: ['-const x = 1;', '+const x = 42;'] },
      ],
    };
    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' },
        result: structuredResult,
        isError: false,
      }),
    );
    const card = screen.getByTestId('chat-edit-card');
    expect(nestedVerticalScrollers(card)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// open-diff button — intent routing (TDD red phase)
// ---------------------------------------------------------------------------

describe('EditFileCard open-diff button intent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Structured result fixture that carries the full file contents on both sides.
  const structuredResultWithFiles = {
    content: 'File edited successfully.',
    structuredPatch: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-const x = 1;', '+const x = 42;'],
      },
    ],
    originalFile: 'const x = 1;\n',
    modifiedFile: 'const x = 42;\n',
  };

  it('structured result emits open-diff (NOT open-file) with path + original + modified', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' },
        result: structuredResultWithFiles,
        isError: false,
      }),
    );

    await userEvent.click(screen.getByTestId('chat-edit-open-diff'));

    const calls = vi.mocked(emitSurfaceIntent).mock.calls;
    expect(calls).toHaveLength(1);
    const emitted = calls[0]![0];

    // Must be an open-diff intent, never open-file.
    expect(emitted.type).toBe('open-diff');
    // Path must be the raw file_path arg.
    expect((emitted as { type: string; path: string }).path).toBe('src/app.ts');
    // The full file contents from the structured result must be forwarded.
    expect((emitted as { original?: string }).original).toBe('const x = 1;\n');
    expect((emitted as { modified?: string }).modified).toBe('const x = 42;\n');
  });

  it('structured result does NOT emit an open-file intent', async () => {
    renderCard(
      makePart({
        args: { file_path: 'src/app.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' },
        result: structuredResultWithFiles,
        isError: false,
      }),
    );

    await userEvent.click(screen.getByTestId('chat-edit-open-diff'));

    const calls = vi.mocked(emitSurfaceIntent).mock.calls;
    expect(calls.every((c) => c[0].type !== 'open-file')).toBe(true);
  });

  it('fallback (plain-string result, no originalFile/modifiedFile) emits open-diff with correct path', async () => {
    // No structuredPatch — the card computes diff from old/new strings.
    renderCard(
      makePart({
        args: { file_path: 'lib/util.ts', old_string: 'hello world', new_string: 'hello universe' },
        result: 'OK',
        isError: false,
      }),
    );

    await userEvent.click(screen.getByTestId('chat-edit-open-diff'));

    const calls = vi.mocked(emitSurfaceIntent).mock.calls;
    expect(calls).toHaveLength(1);
    const emitted = calls[0]![0];

    // Must route through open-diff, not open-file, even for the fallback path.
    expect(emitted.type).toBe('open-diff');
    expect((emitted as { type: string; path: string }).path).toBe('lib/util.ts');
  });
});
