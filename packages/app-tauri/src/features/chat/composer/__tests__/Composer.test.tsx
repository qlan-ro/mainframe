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
import { render, screen } from '@testing-library/react';
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
  // useAuiState in SendOrCancelButton checks thread.isRunning; return false so Send renders.
  useAuiState: () => false,
}));

// Edit context — editing is null so Composer renders the normal shell, not ComposerEditMode.
vi.mock('../../edit/composer-edit-context', () => ({
  useComposerEdit: () => ({ editing: null, cancelEdit: vi.fn() }),
}));

// ComposerToolbar uses many hooks internally — stub it to avoid those.
vi.mock('../../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: () => null,
}));

// Attachment components call useAuiState internally — stub them.
vi.mock('@/components/ui/assistant-ui/attachment', () => ({
  ComposerAttachments: () => null,
  ComposerAddAttachment: () => null,
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
  });

  it('renders without crashing and shows no banner when extras is undefined', () => {
    __extrasReturn = 'none';
    renderComposer();

    expect(screen.queryByTestId('chat-composer-worktree-missing')).not.toBeInTheDocument();
    // The composer root should still be present
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
  });
});
