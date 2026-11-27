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
 *      useAui → thread.append + composer.{__internal_getRuntime,getState,reset},
 *        the shape `useSubmitComposition` consumes (Send is now a plain
 *        `<button type="submit">` inside `ComposerPrimitive.Root`, not a primitive)
 *  - Mock `./edit/composer-edit-context` to return { editing: null, cancelEdit: vi.fn() }
 *    (edit mode is inactive in all cases tested here).
 *  - Mock the card's children at their module seams (toolbar, strips, queue rows,
 *    context ring, send controls, add menu, attachment strip) so their hooks
 *    don't run; each has its own suite. The toolbar stub exposes the
 *    `cyclePermission` handle ⇧⇥ drives.
 *  - All assertions use hardcoded expected values.
 *
 * The field's own behaviour (ARIA, placeholder copy, Enter, ⇧⇥, Escape, focus)
 * runs against both fields, textarea and chips, in
 * `composer-field-modes.test.tsx`. What stays here is the textarea path's
 * structure: the overlay behind a transparent textarea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';

const THREAD_ID = 'thread-1';

// ---------------------------------------------------------------------------
// Mocks (hoisted — vi.mock is hoisted to the top of the file by Vitest)
// ---------------------------------------------------------------------------

// Mutable state for @assistant-ui/react mocks — mutated per-test via helpers below.
// `__isRunning` controls the value that useAuiState returns when the selector
// `(s) => s.thread.isRunning` is applied. The stub invokes the selector against
// a fake state object so the real selector path is exercised.
let __isRunning = false;
let __messages: unknown[] = [];
// useSubmitComposition's imperative read (submit's __internal_getRuntime-first
// path — see use-submit-composition.ts) — non-empty by default so the
// Enter-to-queue tests exercise a real submit, not a no-op guarded by emptiness.
let __appendSpy = vi.fn();
const __resetSpy = vi.fn();
const __composerGetState = () => ({ text: 'queued message', attachments: [], runConfig: {} });

// Stub ComposerPrimitive with passthrough primitives that forward the props
// our assertions depend on (data-testid, disabled, children).
// The chat's agent can take a message mid-turn, so Enter follows the setting.
vi.mock('../send/use-enter-mode', async () => {
  const { useUiPrefs: prefs } = await import('@/store/ui-prefs');
  return { useCanSteer: () => true, useEnterMode: () => prefs((state) => state.enterWhileRunning) };
});
vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    AttachmentDropzone: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
    // `cancelOnEscape` is an aui-only prop (real ComposerPrimitive.Input
    // wires it to its own Escape-cancel handling) — drop it before spreading
    // onto the DOM textarea, or React warns about an unrecognized attribute.
    Input: ({
      children,
      cancelOnEscape: _cancelOnEscape,
      ...rest
    }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { cancelOnEscape?: boolean }) => (
      <textarea {...rest}>{children}</textarea>
    ),
    Cancel: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  // useAuiState invokes the selector against a fake state object. This means
  // the component's real selectors are exercised and the return value tracks
  // the mutable cells above. Composer, SendOrStopButton, and the placeholder
  // logic all call useAuiState with selectors over this same fake state object.
  useAuiState: (
    selector: (s: { thread: { isRunning: boolean; messages: unknown[] }; threadListItem: { id: string } }) => unknown,
  ) => selector({ thread: { isRunning: __isRunning, messages: __messages }, threadListItem: { id: THREAD_ID } }),
  // useAui returns thread()/composer() handles matching useSubmitComposition's
  // shape: thread().append is a spy so tests can assert on it; composer()
  // exposes __internal_getRuntime().getState() (the live read submit() prefers)
  // and a no-op reset().
  useAui: () => ({
    // Delegate rather than capture: tests reassign `__appendSpy`, and the scope
    // is now a plain property read once per render.
    thread: { append: (...args: unknown[]) => __appendSpy(...args) },
    composer: {
      __internal_getRuntime: () => ({ getState: __composerGetState }),
      getState: __composerGetState,
      reset: __resetSpy,
    },
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

// ⇧⇥ reaches the permissions through the toolbar's imperative handle.
const cyclePermission = vi.fn();
vi.mock('../config-toolbar/ComposerToolbar', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    ComposerToolbar: ({ ref }: { ref?: React.Ref<{ cyclePermission: () => void }> }) => {
      useImperativeHandle(ref, () => ({ cyclePermission }));
      return null;
    },
  };
});

// The card's other children each have their own suite.
vi.mock('../attachments/ComposerAttachmentStrip', () => ({ ComposerAttachments: () => null }));
vi.mock('../attachments/ComposerAddMenu', () => ({ ComposerAddMenu: () => null }));
vi.mock('../strips/TopStrip', () => ({ TopStrip: () => <div data-testid="top-strip-stub" /> }));
vi.mock('../queue/QueuedRows', () => ({ QueuedRows: () => null }));
vi.mock('../config-toolbar/ContextRing', () => ({ ContextRing: () => null }));
vi.mock('../send/SendControls', () => ({ SendControls: () => <div data-testid="send-controls-stub" /> }));

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

// The stubbed `@assistant-ui/react` above can only host the textarea field.
beforeEach(() => useUiPrefs.setState({ chipComposer: false }));

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
});

// ---------------------------------------------------------------------------
// The card's parts
// ---------------------------------------------------------------------------

describe('Composer — structure', () => {
  beforeEach(() => {
    __isRunning = false;
    __messages = [];
  });

  it('hosts the send controls inside the card and the strip above it', () => {
    renderComposer();

    expect(screen.getByTestId('chat-composer')).toContainElement(screen.getByTestId('send-controls-stub'));
    expect(screen.getByTestId('top-strip-stub')).toBeInTheDocument();
  });

  it('the side variant has no strip', () => {
    useUiPrefs.setState({ chipComposer: false });
    render(
      <TooltipProvider>
        <Composer variant="side" />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('top-strip-stub')).toBeNull();
    expect(screen.getByTestId('chat-composer-input')).toBeInTheDocument();
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
