// @vitest-environment jsdom
/**
 * Behavior tests for useComposerTuning — pure-reader + fire-and-forget PATCH.
 *
 * What we verify:
 *   - chat is read live from extras.state.chatConfig (no getChat, no local state)
 *   - adapter + model are resolved from the passed adapters array
 *   - setEffort / setFeature / setModel / setPlanMode / setPermissionMode each
 *     fire the correct PATCH with exactly the right args (hardcoded expectations)
 *   - PATCH rejection is swallowed (fire-and-forget .catch(console.warn))
 *   - disabled mirrors useAuiState isRunning
 *   - mutators are no-ops when extras / chatId are absent
 *
 * Mocking strategy
 * ----------------
 * 1. `@assistant-ui/react` → stub `useAuiState` to return a fixed isRunning
 *    value (false by default).
 * 2. `../runtime/use-chat-thread-runtime` → stub `useChatExtras` to return a
 *    fake extras whose `state.chatConfig` carries the chat fixture.
 * 3. `@/lib/api/chats` → vi.fn() stubs for `setChatTuning` and `setChatConfig`.
 * 4. `@/lib/api/adapters` → stub `getAdapters` (silenced; not under test here).
 *
 * `useProviderDefaults` reads the real (unmocked) `@/store/settings` zustand
 * store — it's module-global, so `providers` is reset to `{}` in `beforeEach`
 * to re-arm its seed-guard and keep tests isolated from each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be declared before imports that depend on them)
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/api/settings', () => ({
  getProviderSettings: vi.fn().mockResolvedValue({ claude: { defaultEffort: 'high', defaultUltracode: 'true' } }),
}));

vi.mock('../../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: vi.fn(),
}));

vi.mock('@/lib/api/chats', () => ({
  setChatTuning: vi.fn().mockResolvedValue(undefined),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/adapters', () => ({
  getAdapters: vi.fn().mockResolvedValue([]),
}));

// Draft-config mock — patchDraftConfig spy + useDraftConfig stub.
const patchDraftConfigSpy = vi.fn();
const initializeDraftSpy = vi.fn();
let draftConfigStub: unknown = undefined;

vi.mock('@/features/sessions/runtime/draft-config', () => ({
  patchDraftConfig: (...args: unknown[]) => patchDraftConfigSpy(...args),
  useDraftConfig: (_localId: string | null) => draftConfigStub,
}));

vi.mock('@/features/sessions/new-thread/initialize-draft', () => ({
  reinitializeDraftAdapter: (...args: unknown[]) => initializeDraftSpy(...args),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useComposerTuning, useProviderDefaults } from '../use-composer-tuning';
import { useChatExtras } from '../../../runtime/use-chat-thread-runtime';
import { useAuiState } from '@assistant-ui/react';
import { setChatTuning, setChatConfig } from '@/lib/api/chats';
import type { Chat, AdapterInfo } from '@qlan-ro/mainframe-types';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';
import { waitFor } from '@testing-library/react';
import { displayEffort, effectiveFeature } from '@/lib/model-tuning';
import { getProviderSettings } from '@/lib/api/settings';
import { useSettingsStore } from '@/store/settings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-tuning-test';
const PORT = 9988;

/** Minimal Chat fixture with all tuning fields present. */
function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: CHAT_ID,
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    effort: 'medium',
    ultracode: false,
    fast: false,
    adaptiveThinking: false,
    ...overrides,
  };
}

/** Minimal AdapterInfo with two models — one default. */
const ADAPTER_CLAUDE: AdapterInfo = {
  id: 'claude',
  name: 'Claude',
  models: [
    { id: 'claude-3-haiku', name: 'Haiku', isDefault: false },
    { id: 'claude-3-sonnet', name: 'Sonnet', isDefault: true },
    { id: 'claude-3-opus', name: 'Opus', isDefault: false },
  ],
} as unknown as AdapterInfo;

/** Fake extras whose state.chatConfig carries the supplied chat. */
function makeFakeExtras(chat: Chat | null = makeChat()) {
  return {
    state: { chatId: CHAT_ID, chatConfig: chat },
    port: PORT,
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  patchDraftConfigSpy.mockReset();
  initializeDraftSpy.mockReset();
  draftConfigStub = undefined;
  // useSettingsStore is module-global and persists across tests. Reset `providers`
  // to `{}` so useProviderDefaults' seed-guard (`Object.keys(providers).length > 0`)
  // re-arms and every test observes its own fetch, not a prior test's leftover state.
  useSettingsStore.getState().loadProviders({});
  vi.mocked(useAuiState).mockReturnValue(false);
  vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
  vi.mocked(setChatTuning).mockResolvedValue(undefined as unknown as Chat);
  vi.mocked(setChatConfig).mockResolvedValue(undefined as unknown as Chat);
});

// ---------------------------------------------------------------------------
// 1. chat reads live from extras.state.chatConfig
// ---------------------------------------------------------------------------

describe('useComposerTuning — chat from extras.state.chatConfig', () => {
  it('returns the chat object directly from chatConfig (no getChat call)', () => {
    const chat = makeChat({ effort: 'high' });
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras(chat) as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    expect(result.current.chat).toBe(chat);
  });

  it('resolves adapter from the passed adapters array using chat.adapterId', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ adapterId: 'claude' })) as unknown as ReturnType<typeof useChatExtras>,
    );

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    expect(result.current.adapter?.id).toBe('claude');
  });

  it('resolves the default model when chat.model is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: undefined })) as unknown as ReturnType<typeof useChatExtras>,
    );

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    // Default model from the fixture adapter is 'claude-3-sonnet'.
    expect(result.current.model?.id).toBe('claude-3-sonnet');
  });

  it('resolves the explicit chat model when chat.model is set', () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: 'claude-3-opus' })) as unknown as ReturnType<typeof useChatExtras>,
    );

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    expect(result.current.model?.id).toBe('claude-3-opus');
  });

  it('returns null chat/adapter/model when chatConfig is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras(null) as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    expect(result.current.chat).toBeNull();
    expect(result.current.adapter).toBeNull();
    expect(result.current.model).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. setEffort fires setChatTuning with { effort }
// ---------------------------------------------------------------------------

describe('useComposerTuning — setEffort', () => {
  it("calls setChatTuning(port, chatId, { effort: 'high' }) exactly once", () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('high');
    });

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { effort: 'high' });
  });

  it('does not mutate local state (chat object unchanged after setEffort)', () => {
    const chat = makeChat({ effort: 'medium' });
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras(chat) as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('high');
    });

    // No optimistic update — chat is still the fixture (unchanged).
    expect(result.current.chat?.effort).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// 3. setFeature sends only the touched key
// ---------------------------------------------------------------------------

describe('useComposerTuning — setFeature sends only the touched key', () => {
  it('calls setChatTuning with { ultracode: true } (no other fields)', () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setFeature('ultracode', true);
    });

    const [portArg, chatIdArg, tuningArg] = vi.mocked(setChatTuning).mock.calls[0]!;
    expect(portArg).toBe(PORT);
    expect(chatIdArg).toBe(CHAT_ID);
    expect(tuningArg).toEqual({ ultracode: true });
  });

  it('calls setChatTuning with { fast: false } when toggling fast off', () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setFeature('fast', false);
    });

    const [, , tuningArg] = vi.mocked(setChatTuning).mock.calls[0]!;
    expect(tuningArg).toEqual({ fast: false });
  });
});

// ---------------------------------------------------------------------------
// 4. setModel fires setChatConfig with { model }
// ---------------------------------------------------------------------------

describe('useComposerTuning — setModel', () => {
  it("calls setChatConfig(port, chatId, { model: 'claude-x' }) exactly once", () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setModel('claude-x');
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { model: 'claude-x' });
  });
});

// ---------------------------------------------------------------------------
// 5. setAdapter fires setChatConfig with { adapterId }
// ---------------------------------------------------------------------------

describe('useComposerTuning — setAdapter', () => {
  it("calls setChatConfig(port, chatId, { adapterId: 'gemini' }) exactly once", () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setAdapter('gemini');
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { adapterId: 'gemini' });
  });
});

// ---------------------------------------------------------------------------
// 6. setPlanMode / setPermissionMode fire setChatConfig
// ---------------------------------------------------------------------------

describe('useComposerTuning — setPlanMode and setPermissionMode', () => {
  it('calls setChatConfig(port, chatId, { planMode: true })', () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setPlanMode(true);
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { planMode: true });
  });

  it("calls setChatConfig(port, chatId, { permissionMode: 'yolo' })", () => {
    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setPermissionMode('yolo' as Parameters<typeof result.current.setPermissionMode>[0]);
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, {
      permissionMode: 'yolo',
    });
  });
});

// ---------------------------------------------------------------------------
// 6. disabled mirrors useAuiState isRunning
// ---------------------------------------------------------------------------

describe('useComposerTuning — disabled', () => {
  it('is true when useAuiState reports isRunning=true', () => {
    vi.mocked(useAuiState).mockReturnValue(true);

    const { result } = renderHook(() => useComposerTuning([]));

    expect(result.current.disabled).toBe(true);
  });

  it('is false when useAuiState reports isRunning=false', () => {
    vi.mocked(useAuiState).mockReturnValue(false);

    const { result } = renderHook(() => useComposerTuning([]));

    expect(result.current.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. PATCH rejection is swallowed (fire-and-forget)
// ---------------------------------------------------------------------------

describe('useComposerTuning — PATCH rejection is swallowed', () => {
  it('does not throw when setChatTuning rejects', async () => {
    vi.mocked(setChatTuning).mockRejectedValue(new Error('daemon unreachable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useComposerTuning([]));

    // Must not throw synchronously or produce an unhandled rejection.
    await expect(
      new Promise<void>((resolve) => {
        act(() => {
          result.current.setEffort('high');
        });
        // Flush microtasks so the .catch fires.
        setTimeout(resolve, 0);
      }),
    ).resolves.toBeUndefined();

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. no-op when extras are absent
// ---------------------------------------------------------------------------

describe('useComposerTuning — no-op without extras', () => {
  it('does not call setChatTuning when useChatExtras returns undefined', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('high');
    });

    expect(vi.mocked(setChatTuning)).not.toHaveBeenCalled();
  });

  it('returns null chat when extras are absent', () => {
    vi.mocked(useChatExtras).mockReturnValue(undefined);

    const { result } = renderHook(() => useComposerTuning([]));

    expect(result.current.chat).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Draft mode — __LOCALID_* id + draft + null chatConfig
// ---------------------------------------------------------------------------

const LOCAL_DRAFT_ID = '__LOCALID_draft-test';
const DRAFT_PORT = 9988;

/** Fake extras that mimic a __LOCALID_* thread with NO daemon chat yet. */
function makeDraftExtras() {
  return {
    state: { chatId: LOCAL_DRAFT_ID, chatConfig: null },
    port: DRAFT_PORT,
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

/** Minimal draft config fixture. */
function makeDraft(overrides?: Partial<DraftCfg>): DraftCfg {
  return {
    projectId: 'proj-draft',
    adapterId: 'claude',
    permissionMode: 'default',
    model: 'claude-3-sonnet',
    planMode: true,
    effort: 'high',
    fast: true,
    ultracode: false,
    adaptiveThinking: true,
    ...overrides,
  };
}

describe('useComposerTuning — draft mode: chat is synthesized from the draft', () => {
  it('chat.adapterId and chat.projectId reflect the draft when chatConfig is null', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    expect(result.current.chat?.adapterId).toBe('claude');
    expect(result.current.chat?.projectId).toBe('proj-draft');
  });

  it('chat.model reflects the draft model', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft({ model: 'claude-3-opus' });

    const { result } = renderHook(() => useComposerTuning([]));

    expect(result.current.chat?.model).toBe('claude-3-opus');
  });

  it('keeps every initialized snapshot field after provider settings change', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();
    vi.mocked(getProviderSettings).mockResolvedValue({
      claude: {
        defaultModel: 'claude-3-haiku',
        defaultMode: 'yolo',
        defaultPlanMode: 'false',
        defaultEffort: 'low',
        defaultFast: 'false',
        defaultUltracode: 'true',
        defaultAdaptiveThinking: 'false',
      },
    });

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));
    await waitFor(() => expect(result.current.providerDefaults).toBeDefined());

    expect(result.current.chat).toMatchObject({
      adapterId: 'claude',
      model: 'claude-3-sonnet',
      permissionMode: 'default',
      planMode: true,
      effort: 'high',
      fast: true,
      ultracode: false,
      adaptiveThinking: true,
    });
  });
});

describe('useComposerTuning — draft mode: adapter switch reinitializes the snapshot', () => {
  it('awaits initialization for the selected adapter and ignores a repeated in-flight choice', async () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();
    const pending = new Promise<DraftCfg>(() => undefined);
    initializeDraftSpy.mockReturnValue(pending);

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));
    act(() => {
      result.current.setAdapter('gemini');
      result.current.setAdapter('gemini');
    });

    expect(initializeDraftSpy).toHaveBeenCalledExactlyOnceWith({
      localId: LOCAL_DRAFT_ID,
      projectId: 'proj-draft',
      port: DRAFT_PORT,
      defaultAdapterId: null,
      adapters: [ADAPTER_CLAUDE],
      adapterId: 'gemini',
    });
    expect(patchDraftConfigSpy).not.toHaveBeenCalled();
  });
});

describe('useComposerTuning — draft mode: setters patch draftConfig, never the live chat setter', () => {
  it.each<{
    label: string;
    run: (result: ReturnType<typeof useComposerTuning>) => void;
    expectedPatch: Partial<DraftCfg>;
    liveSetter: typeof setChatConfig | typeof setChatTuning;
  }>([
    {
      label: 'setModel',
      run: (result) => result.setModel('claude-3-haiku'),
      expectedPatch: { model: 'claude-3-haiku' },
      liveSetter: setChatConfig,
    },
    {
      label: 'setEffort',
      run: (result) => result.setEffort('high'),
      expectedPatch: { effort: 'high' },
      liveSetter: setChatTuning,
    },
    {
      label: 'setFeature("ultracode", true)',
      run: (result) => result.setFeature('ultracode', true),
      expectedPatch: { ultracode: true },
      liveSetter: setChatTuning,
    },
    {
      label: 'setPermissionMode',
      run: (result) => result.setPermissionMode('yolo' as Parameters<typeof result.setPermissionMode>[0]),
      expectedPatch: { permissionMode: 'yolo' },
      liveSetter: setChatConfig,
    },
    {
      label: 'setPlanMode',
      run: (result) => result.setPlanMode(true),
      expectedPatch: { planMode: true },
      liveSetter: setChatConfig,
    },
  ])(
    '$label patches draftConfig with the expected fields and does not call the live setter',
    ({ run, expectedPatch, liveSetter }) => {
      vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
      draftConfigStub = makeDraft();

      const { result } = renderHook(() => useComposerTuning([]));

      act(() => {
        run(result.current);
      });

      expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, expectedPatch);
      expect(vi.mocked(liveSetter)).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// 10. Regression: post-first-send state — chatId is STILL the stale
//     __LOCALID_* id (the reducer hadn't flipped it / hasn't landed yet) but
//     chatConfig is already the real daemon chat. Every setter must PATCH the
//     REAL daemon id, never the dead local id (the root cause of "model/effort/
//     plan/permission switching is silently dead for the rest of the session").
// ---------------------------------------------------------------------------

const REAL_CHAT_ID = 'chat-real-after-adopt';

/** Fake extras mimicking the post-first-send gap: stale local chatId + real chatConfig. */
function makePostAdoptExtras(chat: Chat = makeChat({ id: REAL_CHAT_ID })) {
  return {
    state: { chatId: LOCAL_DRAFT_ID, chatConfig: chat },
    port: PORT,
    permissions: {},
    queued: {},
    cancel: vi.fn(),
    replyToPermission: vi.fn(),
    cancelQueued: vi.fn(),
    editQueued: vi.fn(),
  };
}

describe('useComposerTuning — post-first-send gap: chatId stale, chatConfig real', () => {
  it('setEffort PATCHes the real daemon id, not the stale __LOCALID_* chatId', () => {
    vi.mocked(useChatExtras).mockReturnValue(makePostAdoptExtras() as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('high');
    });

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(PORT, REAL_CHAT_ID, { effort: 'high' });
    expect(patchDraftConfigSpy).not.toHaveBeenCalled();
  });

  it('setFeature PATCHes the real daemon id', () => {
    vi.mocked(useChatExtras).mockReturnValue(makePostAdoptExtras() as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setFeature('ultracode', true);
    });

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(PORT, REAL_CHAT_ID, { ultracode: true });
  });

  it('setModel PATCHes the real daemon id via setChatConfig', () => {
    vi.mocked(useChatExtras).mockReturnValue(makePostAdoptExtras() as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setModel('claude-3-opus');
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, REAL_CHAT_ID, { model: 'claude-3-opus' });
  });

  it('setAdapter / setPlanMode / setPermissionMode all PATCH the real daemon id', () => {
    vi.mocked(useChatExtras).mockReturnValue(makePostAdoptExtras() as unknown as ReturnType<typeof useChatExtras>);

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setAdapter('gemini');
    });
    act(() => {
      result.current.setPlanMode(true);
    });
    act(() => {
      result.current.setPermissionMode('yolo' as Parameters<typeof result.current.setPermissionMode>[0]);
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenNthCalledWith(1, PORT, REAL_CHAT_ID, { adapterId: 'gemini' });
    expect(vi.mocked(setChatConfig)).toHaveBeenNthCalledWith(2, PORT, REAL_CHAT_ID, { planMode: true });
    expect(vi.mocked(setChatConfig)).toHaveBeenNthCalledWith(3, PORT, REAL_CHAT_ID, { permissionMode: 'yolo' });
  });
});

describe('useComposerTuning — real chat: setters hit REST helpers, not patchDraftConfig', () => {
  it('setEffort calls setChatTuning and patchDraftConfig is not called', () => {
    // chatConfig is a real chat (non-null) → NOT draft mode.
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = undefined;

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('low');
    });

    expect(vi.mocked(setChatTuning)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { effort: 'low' });
    expect(patchDraftConfigSpy).not.toHaveBeenCalled();
  });

  it('setModel calls setChatConfig and patchDraftConfig is not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = undefined;

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setModel('claude-3-haiku');
    });

    expect(vi.mocked(setChatConfig)).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID, { model: 'claude-3-haiku' });
    expect(patchDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 14. composer provider-default inheritance — useProviderDefaults hook reads
//     the shared settings store live (the same store the Settings pane writes),
//     seeding it with one fetch only when nothing has loaded it yet.
// ---------------------------------------------------------------------------

// A minimal tuning model fixture with effort + ultracode support.
const tuningModel = {
  id: 'm',
  supportedEfforts: ['low', 'high'],
  defaultEffort: 'low',
  supportsUltracode: true,
} as unknown as AdapterInfo['models'][number];

describe('composer provider-default inheritance', () => {
  beforeEach(() => {
    vi.mocked(useChatExtras).mockReturnValue(makeFakeExtras() as unknown as ReturnType<typeof useChatExtras>);
    vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultEffort: 'high', defaultUltracode: 'true' } });
  });

  it('displayEffort uses provider defaultEffort when the chat has none', () => {
    const provider = { defaultEffort: 'high' } as const;
    expect(displayEffort({ effort: null }, tuningModel, provider).value).toBe('high');
  });

  it('falls back to model default when provider config is undefined (not yet fetched)', () => {
    expect(displayEffort({ effort: null }, tuningModel, undefined).value).toBe('low');
  });

  it('effectiveFeature reads provider ultracode default', () => {
    expect(effectiveFeature({ ultracode: null }, { defaultUltracode: 'true' }, 'ultracode')).toBe(true);
  });

  it('seeds the store from one fetch when empty, and returns the adapter config', async () => {
    const { result } = renderHook(() => useProviderDefaults('claude'));
    // Before the async fetch resolves the hook returns undefined.
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual({ defaultEffort: 'high', defaultUltracode: 'true' }));
    expect(vi.mocked(getProviderSettings)).toHaveBeenCalledExactlyOnceWith(PORT);
    // ProviderConfig is structurally a TuningDefaults (D-D) — passes through resolution.
    // defaultUltracode:'true' + supportsUltracode:true overrides effort to xhigh (locked).
    expect(displayEffort({ effort: null }, tuningModel, result.current).value).toBe('xhigh');
  });

  it('returns undefined for an unknown adapter id (safe fallback)', async () => {
    const { result } = renderHook(() => useProviderDefaults('nonexistent'));
    await waitFor(() => expect(vi.mocked(getProviderSettings)).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it('does not fetch again when the store is already populated', async () => {
    useSettingsStore.getState().loadProviders({ claude: { defaultEffort: 'high', defaultUltracode: 'true' } });

    const { result } = renderHook(() => useProviderDefaults('claude'));

    // Store is already populated — the hook returns synchronously, no seed fetch fires.
    expect(result.current).toEqual({ defaultEffort: 'high', defaultUltracode: 'true' });
    expect(vi.mocked(getProviderSettings)).not.toHaveBeenCalled();
  });

  it('reflects a Settings-pane store update immediately, with no new fetch', async () => {
    useSettingsStore.getState().loadProviders({ claude: { defaultEffort: 'high' } });

    const { result } = renderHook(() => useProviderDefaults('claude'));
    expect(result.current).toEqual({ defaultEffort: 'high' });

    act(() => {
      useSettingsStore.getState().setProviderConfig('claude', { defaultEffort: 'low' });
    });

    expect(result.current).toEqual({ defaultEffort: 'low' });
    expect(vi.mocked(getProviderSettings)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 15. Todo #235 — model resolution must consult providerDefaults.defaultModel
//     BEFORE falling back to the catalog isDefault/first entry, so a user's
//     configured default model shows pre-send instead of the catalog default.
// ---------------------------------------------------------------------------

describe('useComposerTuning — model resolution honors providerDefaults.defaultModel', () => {
  it('resolves the provider-configured default model when chat.model is unset', async () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: undefined, adapterId: 'claude' })) as unknown as ReturnType<
        typeof useChatExtras
      >,
    );
    vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'claude-3-opus' } });

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    await waitFor(() => expect(result.current.model?.id).toBe('claude-3-opus'));
  });

  it('falls back to the catalog isDefault model when providerDefaults has no defaultModel', async () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: undefined, adapterId: 'claude' })) as unknown as ReturnType<
        typeof useChatExtras
      >,
    );
    vi.mocked(getProviderSettings).mockResolvedValue({ claude: {} });

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    await waitFor(() => expect(vi.mocked(getProviderSettings)).toHaveBeenCalled());
    expect(result.current.model?.id).toBe('claude-3-sonnet');
  });

  it('prefers the explicit chat.model over providerDefaults.defaultModel', async () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: 'claude-3-haiku', adapterId: 'claude' })) as unknown as ReturnType<
        typeof useChatExtras
      >,
    );
    vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'claude-3-opus' } });

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    await waitFor(() => expect(vi.mocked(getProviderSettings)).toHaveBeenCalled());
    expect(result.current.model?.id).toBe('claude-3-haiku');
  });

  it('ignores a providerDefaults.defaultModel id that does not exist in the catalog', async () => {
    vi.mocked(useChatExtras).mockReturnValue(
      makeFakeExtras(makeChat({ model: undefined, adapterId: 'claude' })) as unknown as ReturnType<
        typeof useChatExtras
      >,
    );
    vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'claude-does-not-exist' } });

    const { result } = renderHook(() => useComposerTuning([ADAPTER_CLAUDE]));

    await waitFor(() => expect(vi.mocked(getProviderSettings)).toHaveBeenCalled());
    expect(result.current.model?.id).toBe('claude-3-sonnet');
  });
});
