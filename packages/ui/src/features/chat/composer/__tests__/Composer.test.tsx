/**
 * Composer — behavior tests for the worktreeMissing guard.
 *
 * Strategy:
 *  - Mock `../runtime/use-chat-thread-runtime` to control what `useChatExtras`
 *    returns (worktreeMissing:true/false, worktreePath present/absent, undefined).
 *  - Mock `@assistant-ui/react` with lightweight stub primitives:
 *      ComposerPrimitive.Root → passthrough div
 *      ComposerPrimitive.AttachmentDropzone → passthrough div
 *      ComposerPrimitive.Input → textarea forwarding data-testid + disabled
 *      ComposerPrimitive.Send → button forwarding data-testid + disabled
 *      ComposerPrimitive.Cancel → button forwarding data-testid
 *      useAuiState → returns false (isRunning = false) so the Send button renders
 *  - Mock `./edit/composer-edit-context` to return { editing: null, cancelEdit: vi.fn() }
 *    (edit mode is inactive in all cases tested here).
 *  - Mock `./config-toolbar/ComposerToolbar` and `@/components/ui/assistant-ui/attachment`
 *    to plain no-op stubs so their internal hooks don't run.
 *  - All assertions use hardcoded expected values.
 *
 * Behaviors covered:
 *  1. worktreeMissing=true, worktreePath='/tmp/wt'
 *       → banner present (data-testid="chat-composer-worktree-missing")
 *       → banner text contains '/tmp/wt' inside a <code>
 *       → input has the `disabled` attribute
 *       → send button has the `disabled` attribute
 *  2. worktreeMissing=false
 *       → NO banner
 *       → input NOT disabled
 *  3. chatConfig undefined (useChatExtras returns undefined)
 *       → no banner, no crash
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, createEvent, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Mocks (hoisted — vi.mock is hoisted to the top of the file by Vitest)
// ---------------------------------------------------------------------------

// Control what useChatExtras returns in each test via this mutable cell.
// true = return undefined (no extras); object = return { state: { chatConfig: value } }
let __extrasReturn: 'none' | { worktreeMissing?: boolean; worktreePath?: string } = 'none';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => (__extrasReturn === 'none' ? undefined : { state: { chatConfig: __extrasReturn } }),
}));

// Mutable state for @assistant-ui/react mocks — mutated per-test via helpers below.
// `__isRunning` controls the value that useAuiState returns when the selector
// `(s) => s.thread.isRunning` is applied. The stub invokes the selector against
// a fake state object so the real selector path is exercised.
let __isRunning = false;
let __sendSpy = vi.fn();

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
    Send: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
    Cancel: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  // useAuiState invokes the selector against a fake state object. This means
  // the component's real selector `(s) => s.thread.isRunning` is exercised and
  // the return value tracks __isRunning. Both the Composer and SendOrCancelButton
  // call useAuiState with the same selector, so a single fake state object works.
  useAuiState: (selector: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
    selector({ thread: { isRunning: __isRunning, messages: [] } }),
  // useAui returns a composer handle; send() is a spy so tests can assert on it.
  useAui: () => ({ composer: () => ({ send: __sendSpy }) }),
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
}));

// ComposerQuotePreview renders ComposerPrimitive.Quote/QuoteText/QuoteDismiss,
// none of which the @assistant-ui/react stub above provides — they're irrelevant
// to the worktree-guard + Enter-to-queue behaviors under test. Stub the quote
// module to a no-op, matching the toolbar/attachment/triggers stubs.
vi.mock('@/components/ui/assistant-ui/quote', () => ({
  ComposerQuotePreview: () => null,
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

describe('Composer — worktreeMissing=true shows banner and disables input/send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __sendSpy = vi.fn();
  });

  it('renders the worktree-missing banner', () => {
    __extrasReturn = { worktreeMissing: true, worktreePath: '/tmp/wt' };
    renderComposer();

    expect(screen.getByTestId('chat-composer-worktree-missing')).toBeInTheDocument();
  });

  it('banner text contains the worktreePath inside a <code> element', () => {
    __extrasReturn = { worktreeMissing: true, worktreePath: '/tmp/wt' };
    renderComposer();

    const banner = screen.getByTestId('chat-composer-worktree-missing');
    const code = banner.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('/tmp/wt');
  });

  it('input (chat-composer-input) has the disabled attribute', () => {
    __extrasReturn = { worktreeMissing: true, worktreePath: '/tmp/wt' };
    renderComposer();

    expect(screen.getByTestId('chat-composer-input')).toBeDisabled();
  });

  it('send button (chat-composer-send) has the disabled attribute', () => {
    __extrasReturn = { worktreeMissing: true, worktreePath: '/tmp/wt' };
    renderComposer();

    expect(screen.getByTestId('chat-composer-send')).toBeDisabled();
  });
});

describe('Composer — worktreeMissing=false has no banner and enabled input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __sendSpy = vi.fn();
  });

  it('does NOT render the worktree-missing banner', () => {
    __extrasReturn = { worktreeMissing: false };
    renderComposer();

    expect(screen.queryByTestId('chat-composer-worktree-missing')).not.toBeInTheDocument();
  });

  it('input (chat-composer-input) is NOT disabled', () => {
    __extrasReturn = { worktreeMissing: false };
    renderComposer();

    expect(screen.getByTestId('chat-composer-input')).not.toBeDisabled();
  });
});

describe('Composer — chatConfig undefined (extras not available)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __isRunning = false;
    __sendSpy = vi.fn();
  });

  it('renders without crashing and shows no banner when extras is undefined', () => {
    __extrasReturn = 'none';
    renderComposer();

    expect(screen.queryByTestId('chat-composer-worktree-missing')).not.toBeInTheDocument();
    // The composer root should still be present
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Mid-run Enter-to-queue interception (handleInputKeyDown)
// ---------------------------------------------------------------------------
//
// When isRunning=true and worktreeMissing=false, pressing plain Enter on the
// composer input must call aui.composer().send() exactly once (the daemon-backed
// queue path) and prevent the default browser action.  Every other combination
// must leave sendSpy uncalled so the native path handles the event.

describe('Composer — mid-run Enter-to-queue interception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __sendSpy = vi.fn();
  });

  it('calls send() once and prevents default when isRunning=true and worktreeMissing=false', () => {
    __isRunning = true;
    __extrasReturn = { worktreeMissing: false };
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    // Use createEvent so we can inspect defaultPrevented after dispatch.
    const event = createEvent.keyDown(input, { key: 'Enter', bubbles: true });
    fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(__sendSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call send() when Shift+Enter is pressed (isRunning=true)', () => {
    __isRunning = true;
    __extrasReturn = { worktreeMissing: false };
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(__sendSpy).not.toHaveBeenCalled();
  });

  it('does NOT call send() when isRunning=false (idle — native path handles submit)', () => {
    __isRunning = false;
    __extrasReturn = { worktreeMissing: false };
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(__sendSpy).not.toHaveBeenCalled();
  });

  it('does NOT call send() when isRunning=true but worktreeMissing=true', () => {
    __isRunning = true;
    __extrasReturn = { worktreeMissing: true, worktreePath: '/tmp/wt' };
    renderComposer();

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(__sendSpy).not.toHaveBeenCalled();
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
    __sendSpy = vi.fn();
    __extrasReturn = { worktreeMissing: false };
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
