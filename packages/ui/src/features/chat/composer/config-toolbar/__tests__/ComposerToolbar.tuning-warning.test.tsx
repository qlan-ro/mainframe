import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
/**
 * ComposerToolbar — integration tests for the mid-session tuning warning (todo #288).
 *
 * Renders the REAL ComposerToolbar, useComposerTuning, useTuningWarning and
 * TuningWarningDialog — only real process/IO boundaries are mocked (the API
 * client, the daemon-port + chat-runtime context hooks, git). `useAdaptersStore`
 * is seeded directly (not via `seedAdapters`, whose only-if-newer `modelsRevision`
 * merge would otherwise drop this fixture).
 *
 * Behaviors covered:
 *  1. Model change with messages: confirm PATCHes setChatConfig exactly once
 *     with the picked model.
 *  2. Model change with messages: cancel PATCHes nothing.
 *  3. Effort change with messages: confirm PATCHes setChatTuning exactly once.
 *  4. Effort change with messages: cancel PATCHes nothing.
 *  5. No messages: model/effort changes apply immediately, no dialog.
 *  6. A same-value effort re-pick never opens the dialog.
 *  7. Suppression already set: applies immediately, no dialog.
 *  8. Suppress + confirm: persists the preference AND applies the change.
 *  9. Suppress + cancel: writes nothing (no persisted preference, no PATCH).
 *  10. Dialog body includes/omits the approx context-token parenthetical.
 *  11. R3 regression: a pending dialog is dropped when the chat switches before
 *      confirm — the stale apply never PATCHes the abandoned chat, and a fresh
 *      change on the new chat PATCHes only that chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { useAdaptersStore } from '@/store/adapters';
import { useUiPrefs } from '@/store/ui-prefs';

// ---------------------------------------------------------------------------
// Mutable fake state — read by the mocked hooks below, mutated per test.
// ---------------------------------------------------------------------------

const { fakeAuiState, fakeExtras } = vi.hoisted(() => ({
  fakeAuiState: { thread: { isRunning: false, messages: [] as unknown[] } },
  fakeExtras: {
    state: {
      chatId: 'chat-a' as string | null,
      chatConfig: null as Chat | null,
      contextUsage: null as { percentage: number; totalTokens: number; maxTokens: number } | null,
    },
    port: 31415 as number | null,
    reconcileModelResponse: vi.fn<(chatId: string, request: () => Promise<Chat | undefined>) => Promise<void>>(),
  },
}));

// ---------------------------------------------------------------------------
// Module mocks — factories must not reference out-of-scope variables (use the
// vi.hoisted object above instead).
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: typeof fakeAuiState) => unknown) => selector(fakeAuiState),
}));

vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => fakeExtras,
}));

vi.mock('@/lib/api/chats', () => ({
  setChatTuning: vi.fn().mockResolvedValue(undefined),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
  switchChatProvider: vi.fn(),
}));

vi.mock('@/lib/api/settings', () => ({
  getProviderSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/api/git', () => ({
  enableWorktree: vi.fn().mockResolvedValue(undefined),
  attachWorktree: vi.fn().mockResolvedValue(undefined),
  getGitBranches: vi.fn().mockResolvedValue({ current: 'main', local: [], remote: [], worktrees: [] }),
  getProjectWorktrees: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/adapters', () => ({
  getAdapters: vi.fn().mockResolvedValue([]),
  getEffectiveModel: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/runtime/draft-config', () => ({
  patchDraftConfig: vi.fn(),
  useDraftConfig: vi.fn().mockReturnValue(undefined),
}));

// Import AFTER mocks.
import { ComposerToolbar } from '../ComposerToolbar';
import { setChatConfig, setChatTuning, switchChatProvider } from '@/lib/api/chats';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  description: 'Anthropic Claude',
  installed: true,
  capabilities: { planMode: false },
  models: [
    { id: 'sonnet', label: 'Sonnet 4.5', supportedEfforts: ['high', 'max'], supportsUltracode: true },
    { id: 'opus', label: 'Opus 5', supportedEfforts: ['high', 'max'], supportsUltracode: true },
  ],
};

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-a',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    model: 'sonnet',
    effort: 'high',
    ...overrides,
  };
}

const A_MESSAGE = { id: 'm1' };

function renderToolbar() {
  const view = render(
    <TooltipProvider>
      <ComposerToolbar />
    </TooltipProvider>,
  );
  const activeChat = fakeExtras.state.chatId;
  fakeExtras.reconcileModelResponse.mockImplementation(async (chatId, request) => {
    const chat = await request();
    if (chat && chatId === activeChat && fakeExtras.state.chatId === activeChat) confirmServerModel(view, chat);
  });
  return view;
}

function deferredModel() {
  let resolve!: (chat: Chat) => void;
  const promise = new Promise<Chat>((done) => {
    resolve = done;
  });
  vi.mocked(setChatConfig).mockReturnValueOnce(promise);
  return resolve;
}

function confirmServerModel(view: ReturnType<typeof renderToolbar>, chat: Chat) {
  fakeExtras.state.chatConfig = chat;
  view.rerender(
    <TooltipProvider>
      <ComposerToolbar />
    </TooltipProvider>,
  );
}

async function openModelPicker(): Promise<void> {
  await userEvent.click(screen.getByTestId('composer-model-select'));
  await screen.findByTestId('composer-provider-model-popover');
}

/**
 * Effort now lives in the model row's hover flyout, not a chip of its own.
 * Hover opens it; clicking the row would choose the model and close the menu.
 */
async function openEffortFlyout(): Promise<void> {
  await userEvent.click(screen.getByTestId('composer-model-select'));
  await userEvent.hover(screen.getByTestId('composer-model-select-option-sonnet'));
  await screen.findByTestId('composer-model-sonnet-effort-high');
}

/**
 * fireEvent, not userEvent: moving the pointer off the SubTrigger closes the
 * flyout in jsdom, where Radix's grace-area rects are all zero.
 */
function pickEffort(level: 'high' | 'max'): void {
  fireEvent.click(screen.getByTestId(`composer-model-sonnet-effort-${level}`));
}

// ---------------------------------------------------------------------------
// Reset before each
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAdaptersStore.setState({ byId: { claude: ADAPTER_CLAUDE } });
  useUiPrefs.setState({ dontWarnOnTuningChange: false });
  fakeAuiState.thread.isRunning = false;
  fakeAuiState.thread.messages = [];
  fakeExtras.state.chatId = 'chat-a';
  fakeExtras.state.chatConfig = makeChat();
  fakeExtras.state.contextUsage = null;
  fakeExtras.port = 31415;
});

// ---------------------------------------------------------------------------
// 1-2. Model change with messages: confirm / cancel
// ---------------------------------------------------------------------------

describe('ComposerToolbar — model change mid-session', () => {
  it('confirm PATCHes setChatConfig exactly once with the picked model', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    const dialog = await screen.findByTestId('composer-tuning-warning');
    expect(screen.queryByTestId('composer-provider-model-popover')).toBeNull();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.click(screen.getByTestId('composer-tuning-warning-confirm'));

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { model: 'opus' });
    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
  });

  it('cancel applies nothing and leaves the trigger showing the original model', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await screen.findByTestId('composer-tuning-warning');

    await userEvent.click(screen.getByTestId('composer-tuning-warning-cancel'));

    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
    expect(screen.getByTestId('composer-model-select').textContent).toContain('Sonnet 4.5');
  });
});

// ---------------------------------------------------------------------------
// 3-4. Effort change with messages: confirm / cancel
// ---------------------------------------------------------------------------

describe('ComposerToolbar — effort change mid-session', () => {
  it('confirm PATCHes setChatTuning exactly once with the picked effort', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openEffortFlyout();
    pickEffort('max');
    await screen.findByTestId('composer-tuning-warning');

    await userEvent.click(screen.getByTestId('composer-tuning-warning-confirm'));

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { effort: 'max' });
    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
  });

  it('cancel applies nothing', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openEffortFlyout();
    pickEffort('max');
    await screen.findByTestId('composer-tuning-warning');

    await userEvent.click(screen.getByTestId('composer-tuning-warning-cancel'));

    expect(vi.mocked(setChatTuning)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. No messages: applies immediately, no dialog (model + effort)
// ---------------------------------------------------------------------------

describe('ComposerToolbar — no warning before the first message', () => {
  it.each([
    {
      label: 'model change',
      pick: async () => {
        await openModelPicker();
        await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
      },
      assertApplied: () =>
        expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', {
          model: 'opus',
        }),
    },
    {
      label: 'effort change',
      pick: async () => {
        await openEffortFlyout();
        pickEffort('max');
      },
      assertApplied: () =>
        expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', {
          effort: 'max',
        }),
    },
  ])('$label applies immediately with no dialog when hasMessages is false', async ({ pick, assertApplied }) => {
    fakeAuiState.thread.messages = [];
    renderToolbar();

    await pick();

    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
    assertApplied();
  });
});

// ---------------------------------------------------------------------------
// 6. No-op re-pick never opens the dialog
// ---------------------------------------------------------------------------

describe('ComposerToolbar — no-op re-pick', () => {
  it('does not warn when re-picking the effort already in effect', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    fakeExtras.state.chatConfig = makeChat({ effort: 'high' });
    renderToolbar();

    await openEffortFlyout();
    pickEffort('high');

    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Suppression already set
// ---------------------------------------------------------------------------

describe('ComposerToolbar — suppression already set', () => {
  it('applies immediately with no dialog', async () => {
    useUiPrefs.setState({ dontWarnOnTuningChange: true });
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));

    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { model: 'opus' });
  });
});

// ---------------------------------------------------------------------------
// 8-9. Suppress checkbox
// ---------------------------------------------------------------------------

describe('ComposerToolbar — suppress checkbox', () => {
  it('confirm with suppress checked persists the preference and applies the change', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await screen.findByTestId('composer-tuning-warning');

    await userEvent.click(screen.getByTestId('composer-tuning-warning-suppress'));
    await userEvent.click(screen.getByTestId('composer-tuning-warning-confirm'));

    expect(useUiPrefs.getState().dontWarnOnTuningChange).toBe(true);
    const persisted = JSON.parse(localStorage.getItem('mf:ui-prefs') ?? '{}');
    expect(persisted.state.dontWarnOnTuningChange).toBe(true);
    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { model: 'opus' });
  });

  it('cancel with suppress checked writes nothing', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await screen.findByTestId('composer-tuning-warning');

    await userEvent.click(screen.getByTestId('composer-tuning-warning-suppress'));
    await userEvent.click(screen.getByTestId('composer-tuning-warning-cancel'));

    expect(useUiPrefs.getState().dontWarnOnTuningChange).toBe(false);
    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. Dialog body carries the context-token parenthetical
// ---------------------------------------------------------------------------

describe('ComposerToolbar — dialog body context size', () => {
  it('shows the approx token size when contextUsage is present', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    fakeExtras.state.contextUsage = { percentage: 24, totalTokens: 48000, maxTokens: 200000 };
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    const dialog = await screen.findByTestId('composer-tuning-warning');

    expect(dialog.textContent).toContain('(~48k tokens)');
  });

  it('omits the token size when contextUsage is absent', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    fakeExtras.state.contextUsage = null;
    renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    const dialog = await screen.findByTestId('composer-tuning-warning');

    expect(dialog.textContent).not.toMatch(/\d+k? tokens\)/);
  });
});

// ---------------------------------------------------------------------------
// 11. R3 regression: thread switch drops a pending dialog
// ---------------------------------------------------------------------------

describe('ComposerToolbar — R3: chat switch drops a pending tuning change', () => {
  it('drops the stale dialog on switch and a fresh confirm targets only the new chat', async () => {
    fakeAuiState.thread.messages = [A_MESSAGE];
    const { rerender } = renderToolbar();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await screen.findByTestId('composer-tuning-warning');

    await act(async () => {
      fakeExtras.state.chatId = 'chat-b';
      fakeExtras.state.chatConfig = makeChat({ id: 'chat-b', model: 'sonnet' });
      rerender(
        <TooltipProvider>
          <ComposerToolbar />
        </TooltipProvider>,
      );
    });

    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();

    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await userEvent.click(await screen.findByTestId('composer-tuning-warning-confirm'));

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(31415, 'chat-b', { model: 'opus' });
  });
});

describe('ComposerToolbar — model menu stays open', () => {
  it.each(['mouse', 'Enter'] as const)('keeps the menu open with the picked model after %s', async (method) => {
    const user = userEvent.setup();
    vi.mocked(setChatConfig).mockImplementationOnce(() => new Promise(() => undefined));
    const view = renderToolbar();
    await openModelPicker();
    const row = screen.getByTestId('composer-model-select-option-opus');
    if (method === 'mouse') await user.click(row);
    else {
      row.focus();
      await user.keyboard('{Enter}');
    }
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).not.toHaveAccessibleName(/selected/);
    confirmServerModel(view, makeChat({ model: 'opus' }));
    expect(row).toHaveAttribute('aria-label', 'Opus 5, selected');
    expect(screen.getByTestId('composer-model-opus-tuning')).toBeVisible();
  });

  it.each(['Escape', 'outside click', 'trigger'] as const)(
    'keeps the current model open until %s, then returns focus',
    async (dismissal) => {
      const user = userEvent.setup();
      renderToolbar();
      const trigger = screen.getByTestId('composer-model-select');
      await openModelPicker();
      await user.click(screen.getByTestId('composer-model-select-option-sonnet'));
      expect(screen.getByTestId('composer-provider-model-popover')).toBeVisible();
      expect(setChatConfig).not.toHaveBeenCalled();
      if (dismissal === 'Escape') await user.keyboard('{Escape}');
      else if (dismissal === 'trigger') await user.click(trigger);
      else fireEvent.pointerDown(document.body, { button: 0 });
      expect(screen.queryByTestId('composer-provider-model-popover')).toBeNull();
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it('ignores a second pick and tuning while pending, then sends tuning for the confirmed model', async () => {
    const finish = deferredModel();
    renderToolbar();
    await openModelPicker();
    const opus = screen.getByTestId('composer-model-select-option-opus');
    const sonnet = screen.getByTestId('composer-model-select-option-sonnet');
    act(() => {
      fireEvent.click(opus);
      fireEvent.click(sonnet);
    });
    expect(opus).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(opus).toHaveFocus();
    expect(setChatConfig).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { model: 'opus' });
    expect(sonnet).toHaveAccessibleName(/selected/);
    expect(screen.getByTestId('composer-model-select')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Sonnet'),
    );
    expect(opus).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('composer-adapter-select-option-claude')).toBeDisabled();
    fireEvent.click(screen.getByTestId('composer-model-sonnet-effort-max'));
    fireEvent.click(screen.getByTestId('composer-model-sonnet-feature-ultracode'));
    expect(setChatTuning).not.toHaveBeenCalled();

    await act(async () => finish(makeChat({ model: 'opus' })));
    await userEvent.click(screen.getByTestId('composer-model-opus-effort-max'));
    expect(setChatTuning).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { effort: 'max' });
  });

  it('stays locked after an unrelated model update until its own request settles', async () => {
    const finish = deferredModel();
    const view = renderToolbar();
    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-default'));
    expect(screen.getByTestId('composer-model-select-option-default')).toHaveAttribute('aria-disabled', 'true');
    confirmServerModel(view, makeChat({ model: 'opus' }));
    expect(screen.getByTestId('composer-model-select-option-opus')).toHaveAccessibleName(/selected/);
    expect(screen.getByTestId('composer-model-select-option-opus')).toHaveAttribute('aria-disabled', 'true');
    await act(async () => finish(makeChat({ model: 'opus' })));
    expect(screen.getByTestId('composer-model-select-option-opus')).not.toHaveAttribute('aria-disabled');
  });

  it('applies the response before unlocking even if the broadcast is missed', async () => {
    vi.mocked(setChatConfig).mockResolvedValueOnce(makeChat({ model: 'opus' }));
    renderToolbar();
    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    expect(screen.getByTestId('composer-model-select-option-opus')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('composer-model-select-option-opus')).toHaveAccessibleName(/selected/);
    expect(screen.getByTestId('composer-model-opus-tuning')).toBeVisible();
  });

  it('re-enables the old model after a refused request', async () => {
    vi.mocked(setChatConfig).mockRejectedValueOnce(new Error('Model unavailable'));
    renderToolbar();
    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    await waitFor(() =>
      expect(screen.getByTestId('composer-model-select-option-opus')).not.toHaveAttribute('aria-disabled'),
    );
    expect(screen.getByTestId('composer-model-select-option-sonnet')).toHaveAccessibleName(/selected/);
  });

  it.each(['chat', 'daemon', 'reopen'])('late settlement keeps the second pick locked after %s', async (change) => {
    const finishOld = deferredModel();
    const view = renderToolbar();
    await openModelPicker();
    const id = 'composer-model-select-option-opus';
    await userEvent.click(screen.getByTestId(id));
    expect(screen.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
    const daemon = getActiveDaemon();
    try {
      if (change === 'reopen') {
        await userEvent.keyboard('{Escape}');
        await openModelPicker();
      } else if (change === 'daemon') {
        act(() => setActiveDaemon({ ...daemon, id: 'another-daemon' }));
      } else {
        fakeExtras.state.chatId = 'chat-b';
        confirmServerModel(view, makeChat({ id: 'chat-b' }));
      }
      expect(screen.getByTestId(id)).not.toHaveAttribute('aria-disabled');
      const finishNew = deferredModel();
      await userEvent.click(screen.getByTestId(id));
      await act(async () => finishOld(makeChat({ model: 'opus' })));
      expect(screen.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
      await act(async () => finishNew(makeChat({ id: change === 'chat' ? 'chat-b' : 'chat-a', model: 'opus' })));
      expect(screen.getByTestId(id)).not.toHaveAttribute('aria-disabled');
    } finally {
      if (change === 'daemon') act(() => setActiveDaemon(daemon));
    }
  });

  it.each([true, false])('switches in place and waits for confirmation or failure (%s)', async (succeeds) => {
    const codex: AdapterInfo = {
      ...ADAPTER_CLAUDE,
      id: 'codex',
      name: 'Codex',
      models: [{ id: 'gpt', label: 'GPT', supportedEfforts: ['low', 'high'] }],
    };
    useAdaptersStore.setState({ byId: { claude: ADAPTER_CLAUDE, codex } });
    fakeAuiState.thread.messages = [A_MESSAGE];
    let finish!: () => void;
    vi.mocked(switchChatProvider).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            succeeds ? resolve(makeChat({ adapterId: 'codex', model: 'gpt' })) : reject(new Error('Switch refused'));
        }),
    );
    renderToolbar();
    await openModelPicker();
    await userEvent.click(screen.getByTestId('composer-adapter-select-option-codex'));
    await userEvent.click(screen.getByTestId('composer-model-select-option-gpt'));
    expect(switchChatProvider).toHaveBeenCalledExactlyOnceWith(31415, 'chat-a', { adapterId: 'codex', model: 'gpt' });
    expect(screen.queryByTestId('composer-tuning-warning')).toBeNull();
    expect(screen.getByTestId('composer-adapter-select-option-codex')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('composer-model-gpt-tuning')).toBeNull();
    await act(async () => finish());
    if (succeeds) {
      expect(screen.getByTestId('composer-model-gpt-tuning')).toBeVisible();
    } else {
      expect(screen.getByTestId('composer-model-select-option-sonnet')).toHaveAccessibleName(/selected/);
      expect(screen.getByTestId('composer-adapter-select-option-codex')).toBeEnabled();
    }
  });

  it('also keeps model picks open in the combined menu and still closes on a permission pick', async () => {
    vi.mocked(setChatConfig).mockResolvedValueOnce(makeChat({ model: 'opus' }));
    const view = renderToolbar();
    const trigger = screen.getByTestId('composer-model-permission-select');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByTestId('composer-model-select-option-opus'));
    confirmServerModel(view, makeChat({ model: 'opus' }));
    expect(screen.getByTestId('composer-model-opus-tuning')).toBeVisible();
    await userEvent.click(screen.getByTestId('composer-permission-mode-select-option-acceptEdits'));
    expect(screen.queryByTestId('composer-model-opus-tuning')).toBeNull();
  });
});
