import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  FALLBACK_MS,
  markFirstTranscriptShown,
  openAfterFirstPaintForTests,
  resetAfterFirstPaint,
  useAfterFirstPaint,
} from '../after-first-paint';

beforeEach(() => {
  vi.useFakeTimers();
  resetAfterFirstPaint();
});

afterEach(() => {
  vi.useRealTimers();
  openAfterFirstPaintForTests();
});

it('holds the reads back at boot', () => {
  const { result } = renderHook(() => useAfterFirstPaint());
  expect(result.current).toBe(false);
});

it('opens two frames after the first transcript is shown', () => {
  const { result } = renderHook(() => useAfterFirstPaint());
  act(() => markFirstTranscriptShown());
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(16);
  });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(40);
  });
  expect(result.current).toBe(true);
});

it('opens by itself when there is no transcript to show', () => {
  const { result } = renderHook(() => useAfterFirstPaint());
  act(() => {
    vi.advanceTimersByTime(FALLBACK_MS - 1);
  });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current).toBe(true);
});

it('opens every reader at once and stays open for later mounts', () => {
  const first = renderHook(() => useAfterFirstPaint());
  const second = renderHook(() => useAfterFirstPaint());
  act(() => markFirstTranscriptShown());
  act(() => {
    vi.advanceTimersByTime(60);
  });
  expect(first.result.current && second.result.current).toBe(true);
  const later = renderHook(() => useAfterFirstPaint());
  expect(later.result.current).toBe(true);
});
