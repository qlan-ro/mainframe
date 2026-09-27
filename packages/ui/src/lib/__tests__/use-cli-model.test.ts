// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getEffectiveModel } from '../api/adapters';
import { useCliModel } from '../use-cli-model';

vi.mock('../api/adapters', () => ({ getEffectiveModel: vi.fn() }));
beforeEach(() => vi.mocked(getEffectiveModel).mockReset());
afterEach(() => vi.useRealTimers());

it('resolves Codex configuration', async () => {
  vi.mocked(getEffectiveModel).mockResolvedValue('gpt-private');
  const { result } = renderHook(() => useCliModel(31415, 'codex', 'project'));
  await waitFor(() => expect(result.current).toBe('gpt-private'));
});

it('discards old session responses after switching chats', async () => {
  let resolveOld!: (model: string) => void;
  vi.mocked(getEffectiveModel)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValueOnce('claude-opus-5');
  const { result, rerender } = renderHook(({ id }) => useCliModel(31415, 'claude', 'project', id), {
    initialProps: { id: 'old' },
  });
  rerender({ id: 'new' });
  await waitFor(() => expect(result.current).toBe('claude-opus-5'));
  await act(async () => resolveOld('claude-fable-5-1'));
  expect(result.current).toBe('claude-opus-5');
});

it('retries a runtime query after the CLI finishes starting', async () => {
  vi.useFakeTimers();
  vi.mocked(getEffectiveModel).mockResolvedValueOnce(null).mockResolvedValue('claude-fable-5-1');
  const { result } = renderHook(() => useCliModel(31415, 'claude', 'project', 'starting'));
  await act(async () => {});
  expect(result.current).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.current).toBe('claude-fable-5-1');
});
