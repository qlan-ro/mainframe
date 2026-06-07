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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be declared before imports that depend on them)
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn().mockReturnValue(false),
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
let draftConfigStub: unknown = undefined;

vi.mock('@/features/sessions/runtime/draft-config', () => ({
  patchDraftConfig: (...args: unknown[]) => patchDraftConfigSpy(...args),
  useDraftConfig: (_localId: string | null) => draftConfigStub,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useComposerTuning } from '../use-composer-tuning';
import { useChatExtras } from '../../../runtime/use-chat-thread-runtime';
import { useAuiState } from '@assistant-ui/react';
import { setChatTuning, setChatConfig } from '@/lib/api/chats';
import type { Chat, AdapterInfo } from '@qlan-ro/mainframe-types';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

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
  draftConfigStub = undefined;
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
});

describe('useComposerTuning — draft mode: setModel calls patchDraftConfig, NOT setChatConfig', () => {
  it('patchDraftConfig called with {model} and setChatConfig not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setModel('claude-3-haiku');
    });

    expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, { model: 'claude-3-haiku' });
    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();
  });
});

describe('useComposerTuning — draft mode: setEffort calls patchDraftConfig, NOT setChatTuning', () => {
  it('patchDraftConfig called with {effort} and setChatTuning not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setEffort('high');
    });

    expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, { effort: 'high' });
    expect(vi.mocked(setChatTuning)).not.toHaveBeenCalled();
  });
});

describe('useComposerTuning — draft mode: setFeature calls patchDraftConfig, NOT setChatTuning', () => {
  it('patchDraftConfig called with {ultracode: true} and setChatTuning not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setFeature('ultracode', true);
    });

    expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, { ultracode: true });
    expect(vi.mocked(setChatTuning)).not.toHaveBeenCalled();
  });
});

describe('useComposerTuning — draft mode: setPermissionMode calls patchDraftConfig, NOT setChatConfig', () => {
  it('patchDraftConfig called with {permissionMode} and setChatConfig not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setPermissionMode('yolo' as Parameters<typeof result.current.setPermissionMode>[0]);
    });

    expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, { permissionMode: 'yolo' });
    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();
  });
});

describe('useComposerTuning — draft mode: setPlanMode calls patchDraftConfig, NOT setChatConfig', () => {
  it('patchDraftConfig called with {planMode: true} and setChatConfig not called', () => {
    vi.mocked(useChatExtras).mockReturnValue(makeDraftExtras() as unknown as ReturnType<typeof useChatExtras>);
    draftConfigStub = makeDraft();

    const { result } = renderHook(() => useComposerTuning([]));

    act(() => {
      result.current.setPlanMode(true);
    });

    expect(patchDraftConfigSpy).toHaveBeenCalledExactlyOnceWith(LOCAL_DRAFT_ID, { planMode: true });
    expect(vi.mocked(setChatConfig)).not.toHaveBeenCalled();
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
