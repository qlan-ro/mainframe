/**
 * ComposerToolbar — integration test verifying the toolbar guards on a null chat.
 *
 * Strategy:
 *  - Mock useComposerTuning to return a resolved chat by default, overridden per test.
 *  - Mock all external dependencies (API, hooks, git) to prevent real network calls.
 *
 * Behaviors covered:
 *  1. toolbar renders nothing when chat is null
 *  2. the resolved adapter reaches PermissionSelect, so a Claude-only mode is
 *     offered on an adapter that advertises it (todo #325)
 *  3. the side variant drops the provider footer
 *  4. ⇧⇥ cycling and the Unattended confirmation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks — factories must not reference out-of-scope variables
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/api/git', () => ({
  enableWorktree: vi.fn().mockResolvedValue(undefined),
  attachWorktree: vi.fn().mockResolvedValue(undefined),
  getGitBranches: vi.fn().mockResolvedValue({ current: 'main', local: [], remote: [], worktrees: [] }),
  getProjectWorktrees: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/chats', () => ({
  setChatTuning: vi.fn().mockResolvedValue(undefined),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/adapters', () => ({
  getAdapters: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/settings', () => ({
  getProviderSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/features/sessions/runtime/draft-config', () => ({
  patchDraftConfig: vi.fn(),
  useDraftConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: vi.fn().mockReturnValue(null),
}));

// useComposerTuning returns a chat by default; individual tests override this
vi.mock('../use-composer-tuning', () => ({
  useAdapters: vi.fn().mockReturnValue([]),
  useProviderDefaults: vi.fn().mockReturnValue(undefined),
  useComposerTuning: vi.fn().mockReturnValue({
    chat: {
      id: 'c1',
      projectId: 'p1',
      adapterId: 'claude',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      lastContextTokensInput: 0,
    },
    adapter: null,
    model: null,
    setModel: vi.fn(),
    setAdapter: vi.fn(),
    setPermissionMode: vi.fn(),
    draftMode: false,
    setEffort: vi.fn(),
    setFeature: vi.fn(),
    disabled: false,
    providerDefaults: undefined,
    hasMessages: false,
    contextTokens: null,
    tuningWarning: {
      pending: null,
      suppressChecked: false,
      setSuppressChecked: vi.fn(),
      guard: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
    },
  }),
}));

// Import component AFTER mocks
import { ComposerToolbar, type ComposerToolbarHandle } from '../ComposerToolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderToolbar() {
  return render(
    <TooltipProvider>
      <ComposerToolbar />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Reset before each
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. toolbar renders nothing when chat is null
// ---------------------------------------------------------------------------

describe('ComposerToolbar — no render when chat is null', () => {
  it('renders nothing when useComposerTuning returns chat=null', async () => {
    const composerTuningMod = await import('../use-composer-tuning');
    vi.mocked(composerTuningMod.useComposerTuning).mockReturnValueOnce({
      chat: null,
      adapter: null,
      model: null,
      runningModel: null,
      setModel: vi.fn(),
      setAdapter: vi.fn(),
      setPermissionMode: vi.fn(),
      draftMode: false,
      setEffort: vi.fn(),
      setFeature: vi.fn(),
      disabled: false,
      providerDefaults: undefined,
      hasMessages: false,
      contextTokens: null,
      tuningWarning: {
        pending: null,
        suppressChecked: false,
        setSuppressChecked: vi.fn(),
        guard: vi.fn(),
        confirm: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const { container } = renderToolbar();

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. the resolved adapter reaches PermissionSelect (todo #325)
// ---------------------------------------------------------------------------

describe('ComposerToolbar — adapter capabilities reach the permission picker', () => {
  it('offers Auto when the resolved adapter advertises capabilities.autoMode', async () => {
    const composerTuningMod = await import('../use-composer-tuning');
    const base = vi.mocked(composerTuningMod.useComposerTuning).getMockImplementation();
    vi.mocked(composerTuningMod.useComposerTuning).mockReturnValue({
      ...base!([]),
      adapter: {
        id: 'claude',
        name: 'Claude',
        description: '',
        installed: true,
        models: [],
        capabilities: { planMode: true, autoMode: true },
      },
    });

    renderToolbar();
    fireEvent.pointerDown(screen.getByTestId('composer-permission-mode-select'), { button: 0 });

    expect(await screen.findByTestId('composer-permission-mode-select-option-auto')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. variant="side" (todo #344) hides the provider tabs but keeps model +
//    permission controls
// ---------------------------------------------------------------------------

describe('ComposerToolbar — variant="side" (todo #344)', () => {
  const adapter = {
    id: 'claude',
    name: 'Claude',
    description: '',
    installed: true,
    models: [{ id: 'sonnet', label: 'Claude Sonnet 4' }],
    capabilities: { planMode: false },
  };

  async function renderWith(variant: 'main' | 'side') {
    const composerTuningMod = await import('../use-composer-tuning');
    const base = vi.mocked(composerTuningMod.useComposerTuning).getMockImplementation();
    vi.mocked(composerTuningMod.useAdapters).mockReturnValue([adapter]);
    vi.mocked(composerTuningMod.useComposerTuning).mockReturnValue({ ...base!([]), adapter });
    render(
      <TooltipProvider>
        <ComposerToolbar variant={variant} />
      </TooltipProvider>,
    );
    fireEvent.pointerDown(screen.getByTestId('composer-model-select'), { button: 0 });
    await screen.findByTestId('composer-provider-model-popover');
  }

  it('offers the provider footer in the main variant', async () => {
    await renderWith('main');

    expect(screen.getByTestId('composer-provider-footer')).toBeInTheDocument();
  });

  it('has no provider footer in the side variant, and keeps the permission control', async () => {
    await renderWith('side');

    expect(screen.queryByTestId('composer-provider-footer')).toBeNull();
    expect(screen.getByTestId('composer-permission-mode-select')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. ⇧⇥ (C12) reaches the permissions through the handle
// ---------------------------------------------------------------------------

describe('ComposerToolbar — cyclePermission handle (C12)', () => {
  async function mountWithMode(permissionMode: string | undefined) {
    const composerTuningMod = await import('../use-composer-tuning');
    const base = vi.mocked(composerTuningMod.useComposerTuning).getMockImplementation()!([]);
    const setPermissionMode = vi.fn();
    vi.mocked(composerTuningMod.useComposerTuning).mockReturnValue({
      ...base,
      chat: { ...base.chat!, permissionMode: permissionMode as never },
      setPermissionMode,
    });
    const ref = createRef<ComposerToolbarHandle>();
    render(
      <TooltipProvider>
        <ComposerToolbar ref={ref} />
      </TooltipProvider>,
    );
    return { ref, setPermissionMode };
  }

  it('switches Interactive to Auto-Edits and announces it', async () => {
    const { ref, setPermissionMode } = await mountWithMode('default');

    act(() => ref.current!.cyclePermission());

    expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('acceptEdits');
    expect(screen.getByTestId('composer-permission-announcement')).toHaveTextContent(
      'Permissions: Interactive · ⇧⇥ to switch',
    );
  });

  it('is silent until the mode is cycled', async () => {
    await mountWithMode('default');

    expect(screen.getByTestId('composer-permission-announcement')).toBeEmptyDOMElement();
  });

  it('steps Auto-Edits back down to Interactive', async () => {
    const { ref, setPermissionMode } = await mountWithMode('acceptEdits');

    act(() => ref.current!.cyclePermission());

    expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('default');
  });

  it('steps Unattended down to Interactive without asking again', async () => {
    const { ref, setPermissionMode } = await mountWithMode('yolo');

    act(() => ref.current!.cyclePermission());

    expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('default');
  });

  it('asks before turning Unattended on, and applies it only after the user confirms', async () => {
    const { setPermissionMode } = await mountWithMode('default');
    fireEvent.pointerDown(screen.getByTestId('composer-permission-mode-select'), { button: 0 });
    fireEvent.click(await screen.findByTestId('composer-permission-mode-select-option-yolo'));

    expect(await screen.findByText('Run this session unattended?')).toBeInTheDocument();
    expect(setPermissionMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('composer-unattended-confirm-confirm'));

    expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('yolo');
  });
});
