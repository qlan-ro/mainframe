import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStableActivityLabel } from '../use-stable-activity-label';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('holds identity changes for a second but uses the latest candidate at the deadline', () => {
  const view = renderHook(({ identity, text }) => useStableActivityLabel({ identity, text }, true), {
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
it('updates same-identity text and completion immediately and clears pending timers', () => {
  const view = renderHook(({ identity, text, active }) => useStableActivityLabel({ identity, text }, active), {
    initialProps: { identity: 'read', text: 'Reading a', active: true },
  });
  view.rerender({ identity: 'read', text: 'Reading b', active: true });
  expect(view.result.current).toBe('Reading b');
  view.rerender({ identity: 'shell', text: 'Running tests', active: true });
  expect(view.result.current).toBe('Reading b');
  view.rerender({ identity: 'completed', text: 'Read files, ran a command', active: false });
  expect(view.result.current).toBe('Read files, ran a command');
  expect(vi.getTimerCount()).toBe(0);
  view.rerender({ identity: 'next', text: 'Thinking', active: true });
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('changes identity immediately after the stability window has elapsed', () => {
  const view = renderHook(({ identity }) => useStableActivityLabel({ identity, text: identity }, true), {
    initialProps: { identity: 'read' },
  });
  act(() => vi.advanceTimersByTime(1100));
  view.rerender({ identity: 'shell' });
  expect(view.result.current).toBe('shell');
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels a pending identity when the displayed member becomes current again', () => {
  const view = renderHook(({ identity, text }) => useStableActivityLabel({ identity, text }, true), {
    initialProps: { identity: 'read', text: 'Reading a' },
  });
  view.rerender({ identity: 'shell', text: 'Running tests' });
  view.rerender({ identity: 'read', text: 'Reading b' });
  expect(view.result.current).toBe('Reading b');
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(1100));
  expect(view.result.current).toBe('Reading b');
});
