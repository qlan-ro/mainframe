/**
 * useMentionTriggerAdapter — every cache emit must hand out a NEW adapter
 * reference: `useTriggerField` re-lists only on adapter identity, so a fetch
 * that resolves into the same reference would never show its results.
 */
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { MentionCache } from '../mention-adapter';
import { useMentionTriggerAdapter } from '../use-mention-trigger-adapter';

function fakeCache(): MentionCache & { emit: () => void } {
  const listeners = new Set<() => void>();
  return {
    getItems: () => [],
    request: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((listener) => listener()),
  };
}

it('rebuilds the adapter on every cache emit and keeps it stable otherwise', () => {
  const cache = fakeCache();
  const { result, rerender } = renderHook(() => useMentionTriggerAdapter(cache));
  const first = result.current;

  rerender();
  expect(result.current).toBe(first);

  act(() => cache.emit());
  expect(result.current).not.toBe(first);
});
