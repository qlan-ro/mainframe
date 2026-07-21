/**
 * ComposerToolbar — integration test verifying the toolbar guards on a null chat.
 *
 * Strategy:
 *  - Mock useComposerTuning to return a resolved chat by default, overridden per test.
 *  - Mock all external dependencies (API, hooks, git) to prevent real network calls.
 *
 * Behaviors covered:
 *  1. toolbar renders nothing when chat is null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks — factories must not reference out-of-scope variables
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn().mockReturnValue(false),
}));

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

vi.mock('../../../runtime/use-chat-thread-runtime', () => ({
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
    setPlanMode: vi.fn(),
    setEffort: vi.fn(),
    setFeature: vi.fn(),
    disabled: false,
    providerDefaults: undefined,
  }),
}));

// Import component AFTER mocks
import { ComposerToolbar } from '../ComposerToolbar';

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
      setModel: vi.fn(),
      setAdapter: vi.fn(),
      setPermissionMode: vi.fn(),
      setPlanMode: vi.fn(),
      setEffort: vi.fn(),
      setFeature: vi.fn(),
      disabled: false,
      providerDefaults: undefined,
    });

    const { container } = renderToolbar();

    expect(container.firstChild).toBeNull();
  });
});
