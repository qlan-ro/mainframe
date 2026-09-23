// @vitest-environment jsdom
/**
 * useSelectionInScope — split view mounts one ChatSelectionToolbar per zone;
 * only the toolbar whose zone holds the selection may act on it (#359).
 *
 * requestAnimationFrame is stubbed to a synchronously-flushable queue (same
 * recipe as use-thread-bottom-pin.test.tsx) so the mouseup → rAF → check path
 * is exercised deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSelectionInScope } from '../use-selection-in-scope';

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function flushFrame() {
  const callbacks = frames.splice(0);
  callbacks.forEach((callback) => callback(0));
}

function selectTextIn(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function collapseSelection() {
  window.getSelection()?.removeAllRanges();
}

describe('useSelectionInScope', () => {
  it('is always in scope when no scopeRef is given (single toolbar, no contention)', () => {
    const { result } = renderHook(() => useSelectionInScope());
    expect(result.current).toBe(true);
  });

  it('starts out of scope before any selection is made', () => {
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    const { result } = renderHook(() => useSelectionInScope({ current: scope }));
    expect(result.current).toBe(false);
  });

  it('reports in scope once a selection inside the scope element settles on mouseup', () => {
    const scope = document.createElement('div');
    const text = document.createElement('span');
    text.textContent = 'hello world';
    scope.appendChild(text);
    document.body.appendChild(scope);

    const { result } = renderHook(() => useSelectionInScope({ current: scope }));

    act(() => {
      selectTextIn(text);
      document.dispatchEvent(new MouseEvent('mouseup'));
      flushFrame();
    });

    expect(result.current).toBe(true);
  });

  it('reports out of scope when the selection anchor lies outside the scope element', () => {
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    const outside = document.createElement('span');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);

    const { result } = renderHook(() => useSelectionInScope({ current: scope }));

    act(() => {
      selectTextIn(outside);
      document.dispatchEvent(new MouseEvent('mouseup'));
      flushFrame();
    });

    expect(result.current).toBe(false);
  });

  it('re-checks on keyup (keyboard selection extension)', () => {
    const scope = document.createElement('div');
    const text = document.createElement('span');
    text.textContent = 'hello world';
    scope.appendChild(text);
    document.body.appendChild(scope);

    const { result } = renderHook(() => useSelectionInScope({ current: scope }));

    act(() => {
      selectTextIn(text);
      document.dispatchEvent(new KeyboardEvent('keyup'));
      flushFrame();
    });

    expect(result.current).toBe(true);
  });

  it('re-checks on a collapsing selectionchange (e.g. a click clearing the selection)', () => {
    const scope = document.createElement('div');
    const text = document.createElement('span');
    text.textContent = 'hello world';
    scope.appendChild(text);
    document.body.appendChild(scope);

    const { result } = renderHook(() => useSelectionInScope({ current: scope }));

    act(() => {
      selectTextIn(text);
      document.dispatchEvent(new MouseEvent('mouseup'));
      flushFrame();
    });
    expect(result.current).toBe(true);

    act(() => {
      collapseSelection();
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(result.current).toBe(false);
  });
});
