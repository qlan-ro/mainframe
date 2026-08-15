// @vitest-environment jsdom
// The hook is nothing but window listeners and a timer, so it needs a DOM even
// though the file carries no JSX.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INDEX_HINT_DELAY_MS, hintModifierHeld, useIndexHintReveal, useIndexHintsStore } from '../index-hints';

function hold(modifier: 'metaKey' | 'ctrlKey') {
  window.dispatchEvent(new KeyboardEvent('keydown', { [modifier]: true }));
}
function release(modifier: 'metaKey' | 'ctrlKey') {
  window.dispatchEvent(new KeyboardEvent('keyup', { [modifier]: false }));
}

describe('hintModifierHeld', () => {
  it('reads ⌘ on macOS and Ctrl elsewhere — the `mod` key either way', () => {
    expect(hintModifierHeld({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(hintModifierHeld({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(hintModifierHeld({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(hintModifierHeld({ metaKey: true, ctrlKey: false }, false)).toBe(false);
  });
});

describe('useIndexHintReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useIndexHintsStore.setState({ revealed: false });
    // jsdom's navigator reports a non-Mac platform, so `mod` resolves to Ctrl.
    vi.stubGlobal('navigator', { ...navigator, platform: 'Linux x86_64', userAgent: 'Linux' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays hidden until the modifier has been held for the full delay', () => {
    renderHook(() => useIndexHintReveal());

    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS - 1));
    expect(useIndexHintsStore.getState().revealed).toBe(false);

    act(() => void vi.advanceTimersByTime(1));
    expect(useIndexHintsStore.getState().revealed).toBe(true);
  });

  it('hides again when the modifier is released', () => {
    renderHook(() => useIndexHintReveal());
    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS));
    expect(useIndexHintsStore.getState().revealed).toBe(true);

    act(() => release('ctrlKey'));
    expect(useIndexHintsStore.getState().revealed).toBe(false);
  });

  it('never reveals when the modifier is tapped and let go inside the delay', () => {
    renderHook(() => useIndexHintReveal());
    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(100));
    act(() => release('ctrlKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS));

    expect(useIndexHintsStore.getState().revealed).toBe(false);
  });

  it('does not push the reveal into the future while keydown repeats', () => {
    renderHook(() => useIndexHintReveal());
    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(200));
    // A held modifier repeats keydown; re-arming here would reset the clock.
    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS - 200));

    expect(useIndexHintsStore.getState().revealed).toBe(true);
  });

  it('hides on window blur, which swallows the keyup', () => {
    renderHook(() => useIndexHintReveal());
    act(() => hold('ctrlKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS));
    expect(useIndexHintsStore.getState().revealed).toBe(true);

    act(() => void window.dispatchEvent(new Event('blur')));
    expect(useIndexHintsStore.getState().revealed).toBe(false);
  });

  it('ignores a modifier the platform does not bind', () => {
    renderHook(() => useIndexHintReveal());
    // ⌘ off macOS is not the `mod` key, so it must not reveal.
    act(() => hold('metaKey'));
    act(() => void vi.advanceTimersByTime(INDEX_HINT_DELAY_MS));

    expect(useIndexHintsStore.getState().revealed).toBe(false);
  });
});
