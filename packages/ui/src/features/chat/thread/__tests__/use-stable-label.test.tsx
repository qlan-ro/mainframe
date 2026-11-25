import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStableLabel } from '../use-stable-label';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('holds identity changes for a second but uses the latest candidate at the deadline', () => {
  const view = renderHook(({ identity, text }) => useStableLabel({ identity, text }), {
    initialProps: { identity: 'read', text: 'Reading a' },
  });
  act(() => vi.advanceTimersByTime(300));
  view.rerender({ identity: 'edit', text: 'Editing b' });
  expect(view.result.current).toBe('Reading a');
  act(() => vi.advanceTimersByTime(600));
  view.rerender({ identity: 'shell', text: 'Running tests' });
  act(() => vi.advanceTimersByTime(99));
  expect(view.result.current).toBe('Reading a');
  act(() => vi.advanceTimersByTime(1));
  expect(view.result.current).toBe('Running tests');
  view.rerender({ identity: 'edit', text: 'Editing c' });
  act(() => vi.advanceTimersByTime(999));
  expect(view.result.current).toBe('Running tests');
  act(() => vi.advanceTimersByTime(1));
  expect(view.result.current).toBe('Editing c');
});
it('updates same-identity text at once and clears its timer on unmount', () => {
  const view = renderHook(({ identity, text }) => useStableLabel({ identity, text }), {
    initialProps: { identity: 'read', text: 'Reading a' },
  });
  view.rerender({ identity: 'read', text: 'Reading b' });
  expect(view.result.current).toBe('Reading b');
  view.rerender({ identity: 'shell', text: 'Running tests' });
  expect(view.result.current).toBe('Reading b');
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('changes identity immediately after the stability window has elapsed', () => {
  const view = renderHook(({ identity }) => useStableLabel({ identity, text: identity }), {
    initialProps: { identity: 'read' },
  });
  act(() => vi.advanceTimersByTime(1100));
  view.rerender({ identity: 'shell' });
  expect(view.result.current).toBe('shell');
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels a pending identity when the displayed member becomes current again', () => {
  const view = renderHook(({ identity, text }) => useStableLabel({ identity, text }), {
    initialProps: { identity: 'read', text: 'Reading a' },
  });
  view.rerender({ identity: 'shell', text: 'Running tests' });
  view.rerender({ identity: 'read', text: 'Reading b' });
  expect(view.result.current).toBe('Reading b');
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(1100));
  expect(view.result.current).toBe('Reading b');
});
