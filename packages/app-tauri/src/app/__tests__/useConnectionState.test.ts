/**
 * Behavior tests for useConnectionState.
 *
 * Behaviors covered:
 *  1. getDaemonPort rejects → state transitions to 'disconnected' (NOT stuck
 *     on 'connecting') and daemonStatus is set to 'unavailable'.
 *  2. getDaemonPort retries after POLL_INTERVAL_MS — first call rejects, second
 *     resolves → port is set to 31415 and daemonStatus recovers to 'ready'.
 *  3. Happy path — getDaemonPort resolves immediately → port is 31415, state
 *     eventually reaches 'connected' once the health poll returns ok.
 *
 * Strategy
 * --------
 * All bridge functions are mocked at the module level. fetch is stubbed via
 * vi.stubGlobal so the health endpoint can be controlled per-test. Fake timers
 * drive the 2 s retry / poll interval without wall-clock waiting.
 *
 * Microtask flushing: vi.runAllMicrotasksAsync is not available in this vitest
 * version. `vi.advanceTimersByTimeAsync(0)` is used instead — it processes
 * pending timers and drains the microtask queue between ticks, settling async
 * promise chains. `waitFor` is avoided under fake timers because it polls using
 * real time and can deadlock.
 *
 * Note on the 'connected' assertion in test 3:
 *   acquirePort calls poll() directly (no leading timer), so after
 *   advanceTimersByTimeAsync(0) the first poll() runs, checkHealth resolves,
 *   and state is set to 'connected'. We assert this; if the AbortController
 *   timeout interaction is ever flaky, the port assertion is the load-bearing
 *   signal and the state assertion can be softened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, must appear before the import under test.
// ---------------------------------------------------------------------------

vi.mock('../../lib/tauri/bridge', () => ({
  getDaemonPort: vi.fn(),
  getDaemonStatus: vi.fn(),
  onDaemonStatus: vi.fn(),
}));

import { getDaemonPort, getDaemonStatus, onDaemonStatus } from '../../lib/tauri/bridge';
import { useConnectionState, healthUrl } from '../useConnectionState';

// ---------------------------------------------------------------------------
// healthUrl unit tests (no mocks needed — pure function)
// ---------------------------------------------------------------------------

describe('healthUrl', () => {
  it('targets the IPv4 loopback, not localhost (daemon binds 127.0.0.1 only)', () => {
    expect(healthUrl(31416)).toBe('http://127.0.0.1:31416/health');
  });
});

const mockGetDaemonPort = vi.mocked(getDaemonPort);
const mockGetDaemonStatus = vi.mocked(getDaemonStatus);
const mockOnDaemonStatus = vi.mocked(onDaemonStatus);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  // Default: onDaemonStatus resolves to a no-op unlisten fn.
  mockOnDaemonStatus.mockResolvedValue(() => {});
  // Default: fetch is healthy.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useConnectionState', () => {
  it('port reject → state is disconnected, daemonStatus is unavailable (not stuck connecting)', async () => {
    mockGetDaemonPort.mockRejectedValue(new Error('no port'));

    const { result } = renderHook(() => useConnectionState());

    // Advance by 0 ms: settles all pending microtasks (init → acquirePort →
    // catch) without triggering the 2 s retry timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The bug was that a rejected getDaemonPort left state stuck on 'connecting'.
    // After the fix, the catch block must set 'disconnected'.
    expect(result.current.state).toBe('disconnected');
    expect(result.current.daemonStatus).toBe('unavailable');
    // Port was never set.
    expect(result.current.port).toBeNull();
  });

  it('retries acquirePort after POLL_INTERVAL_MS — second call resolves, port and status recover', async () => {
    mockGetDaemonPort.mockRejectedValueOnce(new Error('no port')).mockResolvedValue(31415);
    mockGetDaemonStatus.mockResolvedValue('ready');

    const { result } = renderHook(() => useConnectionState());

    // Let the first acquirePort() run and fail.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // State must be disconnected after the first failure.
    expect(result.current.state).toBe('disconnected');
    expect(result.current.daemonStatus).toBe('unavailable');

    // Advance past POLL_INTERVAL_MS (2000 ms) to fire the retry setTimeout,
    // then drain the resulting promise chain.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    // Port should now be set — the key signal that acquirePort retried.
    expect(result.current.port).toBe(31415);
    expect(result.current.daemonStatus).toBe('ready');
  });

  it('ready is false before the daemon is reachable (port never acquired)', async () => {
    mockGetDaemonPort.mockRejectedValue(new Error('no port'));

    const { result } = renderHook(() => useConnectionState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The data shell must NOT mount until the daemon answers /health, so ready
    // stays false while the port can't even be acquired.
    expect(result.current.ready).toBe(false);
  });

  it('ready latches true on first connect and STAYS true through a later disconnect', async () => {
    mockGetDaemonPort.mockResolvedValue(31415);
    mockGetDaemonStatus.mockResolvedValue('ready');
    // First poll healthy → connected (ready latches true); every later poll
    // unhealthy → disconnected, but ready must remain true so the mounted shell
    // is not torn down by a transient blip.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true } as Response)
        .mockResolvedValue({ ok: false } as Response),
    );

    const { result } = renderHook(() => useConnectionState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('connected');
    expect(result.current.ready).toBe(true);

    // Next poll fires after POLL_INTERVAL_MS and returns unhealthy.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.state).toBe('disconnected');
    expect(result.current.ready).toBe(true); // latched — shell stays mounted
  });

  it('happy path — port resolves immediately, port is set and state reaches connected', async () => {
    mockGetDaemonPort.mockResolvedValue(31415);
    mockGetDaemonStatus.mockResolvedValue('ready');

    const { result } = renderHook(() => useConnectionState());

    // Settle init() + acquirePort() + the first poll() invocation (acquirePort
    // calls poll() directly with no leading timer delay).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Primary assertion: port is set after a successful acquirePort.
    expect(result.current.port).toBe(31415);
    expect(result.current.daemonStatus).toBe('ready');

    // Secondary assertion: the first poll() runs synchronously inside acquirePort
    // (no leading delay), checkHealth resolves ok, so state is 'connected'.
    // If the AbortController timeout interaction ever makes this flaky, the port
    // assertion above is the load-bearing signal and this one can be softened.
    expect(result.current.state).toBe('connected');
  });
});
