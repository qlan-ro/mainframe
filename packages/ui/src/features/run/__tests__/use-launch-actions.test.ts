// @vitest-environment jsdom
/**
 * use-launch-actions — unit tests for the effective-selection logic.
 *
 * Behaviors covered:
 *  - ignores a selection stored under a DIFFERENT scopeKey (the fallback truth
 *    table itself — first-config default, stale-selection fallback, empty
 *    configs — is owned by derive-launch-control.test.ts)
 *  - handleLaunch / handleStop refetch the daemon's REST status afterwards
 *
 * The real useSandboxStore is used (reset via setState in beforeEach) so the
 * scope-keyed behaviour is genuinely exercised, not mocked away.
 *
 * Mocked dependencies: ./use-launch-configs, @/store/layout, @/lib/api/launch, @/lib/toast.
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

// ── mock use-launch-configs ──────────────────────────────────────────────────
// We control configs and statusData synchronously so the hook resolves
// without waiting for async fetches.
import type { UseLaunchConfigsResult } from '../use-launch-configs';

const mockRefetch = vi.fn();
let mockLaunchConfigsResult: UseLaunchConfigsResult = {
  configs: [],
  statusData: null,
  refetch: mockRefetch,
};

vi.mock('../use-launch-configs', () => ({
  useLaunchConfigs: () => mockLaunchConfigsResult,
}));

// ── mock layout store ────────────────────────────────────────────────────────
const addRunTab = vi.fn();
vi.mock('@/store/layout', () => ({
  useLayoutStore: (selector: (s: { addRunTab: typeof addRunTab }) => unknown) => selector({ addRunTab }),
}));

// ── mock launch API ──────────────────────────────────────────────────────────
vi.mock('@/lib/api/launch', () => ({
  startLaunchConfig: vi.fn().mockResolvedValue(undefined),
  stopLaunchConfig: vi.fn().mockResolvedValue(undefined),
  fetchLaunchConfigs: vi.fn().mockResolvedValue([]),
  fetchLaunchStatuses: vi.fn().mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' }),
}));

// ── mock toast ───────────────────────────────────────────────────────────────
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// ── mock useDaemonIsLocal ────────────────────────────────────────────────────
// Default to local so existing tests are unaffected; individual tests can
// override via vi.mocked(useDaemonIsLocal).mockReturnValue(false).
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({
  useDaemonIsLocal: vi.fn().mockReturnValue(true),
}));

// ── fixtures ─────────────────────────────────────────────────────────────────
const devServer: LaunchConfiguration = {
  name: 'dev server',
  runtimeExecutable: 'npm',
  runtimeArgs: ['run', 'dev'],
  port: null,
  url: null,
};
const previewApp: LaunchConfiguration = {
  name: 'preview-app',
  runtimeExecutable: 'npm',
  runtimeArgs: ['run', 'preview'],
  port: 3000,
  url: 'http://localhost:3000',
  preview: true,
};
const twoConfigs = [devServer, previewApp];

// Standard statusData with effectivePath '/repo' so scopeKey = 'proj-1:/repo'
const statusData = { statuses: {}, tunnelUrls: {}, effectivePath: '/repo' };

// ── helpers ───────────────────────────────────────────────────────────────────

// Import the real store for direct state inspection / reset
import { useSandboxStore } from '@/store/sandbox';

const CLEAN_SANDBOX = {
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigByScope: {},
  lastStartedProcess: null,
};

beforeEach(() => {
  useSandboxStore.setState(CLEAN_SANDBOX);
  mockRefetch.mockReset();
  addRunTab.mockReset().mockReturnValue(true);
});

// ── tests ─────────────────────────────────────────────────────────────────────

// The exhaustive selectedConfigName fallback truth table (first-config default,
// stale-selection fallback, empty-configs, etc.) is owned by
// derive-launch-control.test.ts, which tests the pure derivation directly.
// This hook wraps that logic with scope-keyed storage reads from the real
// sandbox store — the one behavior worth re-proving here is that the hook
// actually scopes its read (a global/other-scope value must never bleed in),
// since that plumbing is unique to this layer.
describe('useLaunchActions — selectedConfigName derivation', () => {
  it('ignores a selection stored under a different scopeKey', async () => {
    // 'other:/x' is a completely unrelated scope; proj-1:/repo has nothing stored
    useSandboxStore.setState({ selectedConfigByScope: { 'other:/x': 'preview-app' } });
    mockLaunchConfigsResult = { configs: twoConfigs, statusData, refetch: mockRefetch };
    const { useLaunchActions } = await import('../use-launch-actions');
    const { result } = renderHook(() => useLaunchActions(31415, 'proj-1', 'chat-9'));
    expect(result.current.selectedConfigName).toBe('dev server');
  });
});

describe('useLaunchActions — refetch after start/stop', () => {
  // Bug: the workspace's own launch path (add-menu, empty-state card)
  // shares this hook but never re-synced with the daemon after starting/stopping
  // a config — a fast subprocess's buffered output (seedOutputBuffer, only
  // reachable inside useLaunchConfigs's fetch effect) and a just-stopped
  // process's terminal status were both invisible until something ELSE
  // happened to call refetch().
  it('handleLaunch calls refetch() after startLaunchConfig resolves', async () => {
    mockLaunchConfigsResult = { configs: twoConfigs, statusData, refetch: mockRefetch };
    const { useLaunchActions } = await import('../use-launch-actions');
    const { result } = renderHook(() => useLaunchActions(31415, 'proj-1', 'chat-9'));
    await act(async () => {
      await result.current.handleLaunch(devServer);
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('handleStop calls refetch() after stopLaunchConfig resolves', async () => {
    mockLaunchConfigsResult = { configs: twoConfigs, statusData, refetch: mockRefetch };
    const { useLaunchActions } = await import('../use-launch-actions');
    const { result } = renderHook(() => useLaunchActions(31415, 'proj-1', 'chat-9'));
    await act(async () => {
      await result.current.handleStop(devServer);
    });
    expect(mockRefetch).toHaveBeenCalled();
  });
});
