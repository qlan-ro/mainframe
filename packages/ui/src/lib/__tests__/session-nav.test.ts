/**
 * session-nav unit tests.
 *
 * A module-level seam that lets non-React callers (the global `mfToast`, the
 * WS event routers) request switching the active session by chat id, without
 * reaching through to the assistant-ui runtime. A root component registers the
 * real navigator (`runtime.threads.switchToThread`); everything else calls
 * `openSessionById`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSessionById, setSessionNavigator } from '../session-nav';

afterEach(() => {
  setSessionNavigator(null);
  vi.restoreAllMocks();
});

describe('session-nav', () => {
  it('routes openSessionById to the registered navigator', () => {
    const nav = vi.fn();
    setSessionNavigator(nav);

    const handled = openSessionById('chat-123');

    expect(nav).toHaveBeenCalledWith('chat-123');
    expect(handled).toBe(true);
  });

  it('returns false and warns when no navigator is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handled = openSessionById('chat-123');

    expect(handled).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('clears the navigator when set to null', () => {
    const nav = vi.fn();
    setSessionNavigator(nav);
    setSessionNavigator(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handled = openSessionById('chat-123');

    expect(nav).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });
});
