/**
 * The action store's registration semantics. The stack (rather than a plain
 * id → handler map) is load-bearing: while the surface is split TWO
 * ChatThreads mount and both register `chat.find`, so an unmount that cleared
 * the id unconditionally would leave the surviving thread with a dead chord.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { shortcutAction, useShortcutAction } from '../action-store';

describe('useShortcutAction', () => {
  it('registers a handler the dispatcher can look up by id', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useShortcutAction('chat.find', fn));

    shortcutAction('chat.find')?.(0);

    expect(fn).toHaveBeenCalledWith(0);
    unmount();
  });

  it('leaves the id unregistered once its only owner unmounts', () => {
    const { unmount } = renderHook(() => useShortcutAction('chat.find', vi.fn()));
    unmount();

    expect(shortcutAction('chat.find')).toBeNull();
  });

  it('calls the LATEST callback without re-registering on every render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useShortcutAction('chat.find', fn), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });
    shortcutAction('chat.find')?.(0);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps the earlier registration alive when a second owner unmounts', () => {
    const left = vi.fn();
    const right = vi.fn();
    const leftHook = renderHook(() => useShortcutAction('chat.find', left));
    const rightHook = renderHook(() => useShortcutAction('chat.find', right));

    rightHook.unmount();
    shortcutAction('chat.find')?.(0);

    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
    leftHook.unmount();
  });

  it('dispatches to the most recently mounted owner', () => {
    const left = vi.fn();
    const right = vi.fn();
    const leftHook = renderHook(() => useShortcutAction('chat.find', left));
    const rightHook = renderHook(() => useShortcutAction('chat.find', right));

    shortcutAction('chat.find')?.(0);

    expect(right).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
    rightHook.unmount();
    leftHook.unmount();
  });

  it('reports an id nobody registered as unbound, so its chord stays inert', () => {
    expect(shortcutAction('app.automations')).toBeNull();
  });
});
