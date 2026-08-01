/**
 * Composer — behavior tests for the native composer shell.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` with lightweight stub primitives:
 *      ComposerPrimitive.Root → passthrough div
 *      ComposerPrimitive.AttachmentDropzone → passthrough div
 *      ComposerPrimitive.Input → textarea forwarding data-testid + disabled
 *      ComposerPrimitive.Cancel → button forwarding data-testid
 *      useAuiState → returns false (isRunning = false)
 *      useAui → thread().append + composer().{__internal_getRuntime,getState,reset},
 *        the shape `useSubmitComposition` consumes (Send is now a plain
 *        `<button type="submit">` inside `ComposerPrimitive.Root`, not a primitive)
 *  - Mock `./edit/composer-edit-context` to return { editing: null, cancelEdit: vi.fn() }
 *    (edit mode is inactive in all cases tested here).
 *  - Mock `./config-toolbar/ComposerToolbar` and `@/components/ui/assistant-ui/attachment`
 *    to plain no-op stubs so their internal hooks don't run.
 *  - All assertions use hardcoded expected values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, createEvent, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useComposerSegments } from '../segments/segment-store';

const THREAD_ID = 'thread-1';

// ---------------------------------------------------------------------------
// Mocks (hoisted — vi.mock is hoisted to the top of the file by Vitest)
// ---------------------------------------------------------------------------

// Mutable state for @assistant-ui/react mocks — mutated per-test via helpers below.
// `__isRunning` controls the value that useAuiState returns when the selector
// `(s) => s.thread.isRunning` is applied. The stub invokes the selector against
// a fake state object so the real selector path is exercised.
let __isRunning = false;
// useSubmitComposition's imperative read (submit's __internal_getRuntime-first
// path — see use-submit-composition.ts) — non-empty by default so the
// Enter-to-queue tests exercise a real submit, not a no-op guarded by emptiness.
let __appendSpy = vi.fn();
const __resetSpy = vi.fn();
const __composerGetState = () => ({ text: 'queued message', attachments: [], runConfig: {} });

// Stub ComposerPrimitive with passthrough primitives that forward the props
// our assertions depend on (data-testid, disabled, children).
vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    AttachmentDropzone: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
    Input: ({ children, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...rest}>{children}</textarea>
    ),
    Cancel: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  // useAuiState invokes the selector against a fake state object. This means
  // the component's real selectors are exercised and the return value tracks
  // the mutable cells above. Composer, SendOrCancelButton, and the placeholder
  // logic all call useAuiState with selectors over this same fake state object.
  useAuiState: (
    selector: (s: { thread: { isRunning: boolean; messages: unknown[] }; threadListItem: { id: string } }) => unknown,
  ) => selector({ thread: { isRunning: __isRunning, messages: [] }, threadListItem: { id: THREAD_ID } }),
  // useAui returns thread()/composer() handles matching useSubmitComposition's
  // shape: thread().append is a spy so tests can assert on it; composer()
  // exposes __internal_getRuntime().getState() (the live read submit() prefers)
  // and a no-op reset().
  useAui: () => ({
    thread: () => ({ append: __appendSpy }),
    composer: () => ({
      __internal_getRuntime: () => ({ getState: __composerGetState }),
      getState: __composerGetState,
      reset: __resetSpy,
    }),
  }),
}));

// ComposerSegments reads the real segment store directly; stub the component
// itself so these tests (worktree guard, Enter-to-queue, highlight wiring)
// don't also exercise its rendering — the placeholder-copy tests below drive
// the store directly instead, since Composer computes hasLiveQuote itself.
vi.mock('../segments/ComposerSegments', () => ({
  ComposerSegments: () => null,
}));

// Edit context — editing is null so Composer renders the normal shell, not ComposerEditMode.
vi.mock('../edit/composer-edit-context', () => ({
  useComposerEdit: () => ({ editing: null, cancelEdit: vi.fn() }),
}));

// ComposerToolbar uses many hooks internally — stub it to avoid those.
vi.mock('../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: () => null,
}));

// Attachment components call useAuiState internally — stub them.
vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  ComposerAttachments: () => null,
  ComposerAddAttachment: () => null,
  ComposerAddMention: () => null,
}));

// ComposerTriggers pulls in Unstable_TriggerPopover* primitives, useChatSkills,
// and searchFiles — stub it to a passthrough so Composer.test doesn't exercise
// the native trigger machinery (the triggers have their own unit tests).
vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));

// ComposerHighlight uses useAuiState(s => s.composer.text) and renderHighlights —
// stub it to a sentinel div so Composer.test asserts structural wiring without
// re-testing the overlay's own logic (covered in ComposerHighlight.test.tsx).
vi.mock('../highlight/ComposerHighlight', () => ({
  ComposerHighlight: () => <div data-testid="composer-prompt-highlight" aria-hidden="true" />,
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { Composer } from '../Composer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderComposer() {
  return render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Composer — healthy shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __appendSpy = vi.fn();
  });

  it('does NOT render the old worktree-missing banner', () => {
    renderComposer();

    expect(screen.queryByTestId('chat-composer-worktree-missing')).not.toBeInTheDocument();
  });

  it('input (chat-composer-input) is NOT disabled', () => {
    renderComposer();

    expect(screen.getByTestId('chat-composer-input')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Mid-run Enter-to-queue interception (handleInputKeyDown)
// ---------------------------------------------------------------------------
//
// When isRunning=true, pressing plain Enter on the composer input must call
// submit() → aui.thread().append() exactly once (the daemon-backed queue path)
// and prevent the default browser action. Every other combination must leave
// appendSpy uncalled so the native path handles the event.

describe('Composer — mid-run Enter-to-queue interception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __appendSpy = vi.fn();
  });

  it('calls append() once and prevents default when isRunning=true', () => {
    __isRunning = true;
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    // Use createEvent so we can inspect defaultPrevented after dispatch.
    const event = createEvent.keyDown(input, { key: 'Enter', bubbles: true });
    fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(__appendSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call append() when Shift+Enter is pressed (isRunning=true)', () => {
    __isRunning = true;
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(__appendSpy).not.toHaveBeenCalled();
  });

  it('does NOT call append() when isRunning=false (idle — native path handles submit)', () => {
    __isRunning = false;
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(__appendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Highlight overlay wiring + scroll-wrapper restructure (Task 3)
// ---------------------------------------------------------------------------
//
// Verifies that:
//  1. The ComposerHighlight overlay is mounted (data-testid="composer-prompt-highlight")
//  2. The textarea input carries `text-transparent` (transparent text) and `caret-foreground`
//     so the colored overlay shows through, while the real text caret remains visible.

describe('Composer — highlight overlay wired + input is text-transparent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __appendSpy = vi.fn();
  });

  it('mounts the composer-prompt-highlight overlay', () => {
    renderComposer();
    expect(screen.getByTestId('composer-prompt-highlight')).toBeInTheDocument();
  });

  it('input (chat-composer-input) has text-transparent class', () => {
    renderComposer();
    const input = screen.getByTestId('chat-composer-input');
    expect(input.className).toContain('text-transparent');
  });

  it('input (chat-composer-input) has caret-foreground class', () => {
    renderComposer();
    const input = screen.getByTestId('chat-composer-input');
    expect(input.className).toContain('caret-foreground');
  });
});

// ---------------------------------------------------------------------------
// Placeholder copy — "Reply to Mainframe…" default, "Add a message…" when the
// live segment has a pending quote (finding 8.3: design 03-content.jsx:747).
// The rule now reads the segment store's liveQuote, not the native
// composer.quote (multi-quote composer, #280) — see ComposerSegments.test.tsx
// for the committed-segment half of the same placeholder rule.
// ---------------------------------------------------------------------------

describe('Composer — placeholder copy switches on pending-quote state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __appendSpy = vi.fn();
    useComposerSegments.setState({ byThread: {} });
  });

  it('shows "Reply to Mainframe…" when no quote is pending', () => {
    renderComposer();
    const input = screen.getByTestId('chat-composer-input');
    expect(input).toHaveAttribute('placeholder', 'Reply to Mainframe…');
  });

  it('shows "Add a message…" when the live segment has a pending quote', () => {
    useComposerSegments.setState({
      byThread: { [THREAD_ID]: { committed: [], liveQuote: { id: 'live1', text: 'quoted snippet' } } },
    });
    renderComposer();
    const input = screen.getByTestId('chat-composer-input');
    expect(input).toHaveAttribute('placeholder', 'Add a message…');
  });
});
