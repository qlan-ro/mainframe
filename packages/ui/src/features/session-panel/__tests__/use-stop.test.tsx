/** useStop — one Stop at a time, offered again once the work ends, the request fails, or it had time to take effect. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));

import { useStop } from '../use-stop';

type Request = (() => Promise<void>) | undefined;
const request = vi.fn(async () => undefined);
const mount = (initial: Request = request) =>
  renderHook(({ ask }: { ask: Request }) => useStop('reviewer', ask), { initialProps: { ask: initial as Request } });
const press = async (hook: ReturnType<typeof mount>) => act(async () => hook.result.current.onStop?.());

beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset().mockResolvedValue(undefined);
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => vi.useRealTimers());

it('asks once while it is stopping, and says it stopped', async () => {
  const hook = mount();
  await press(hook);
  await press(hook);
  expect(request).toHaveBeenCalledTimes(1);
  expect(hook.result.current.stopping).toBe(true);
  expect(toast.success).toHaveBeenCalledWith('Stopped “reviewer”');
});

it('is ready again when the work ended and started over', async () => {
  const hook = mount();
  await press(hook);
  hook.rerender({ ask: undefined as Request });
  expect(hook.result.current).toEqual({ onStop: undefined, stopping: false });

  hook.rerender({ ask: request });
  expect(hook.result.current.stopping).toBe(false);
  await press(hook);
  expect(request).toHaveBeenCalledTimes(2);
});

it('is ready again when the work goes on in spite of it', async () => {
  const hook = mount();
  await press(hook);
  act(() => vi.advanceTimersByTime(9_999));
  expect(hook.result.current.stopping).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(hook.result.current.stopping).toBe(false);
  await press(hook);
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not let an earlier Stop end a later one', async () => {
  let settle = () => undefined as void;
  request.mockImplementationOnce(() => new Promise<void>((resolve) => (settle = resolve)) as Promise<undefined>);
  const hook = mount();
  await press(hook);
  hook.rerender({ ask: undefined as Request });
  hook.rerender({ ask: request });
  await act(async () => settle());
  act(() => vi.advanceTimersByTime(5_000));
  await press(hook);
  act(() => vi.advanceTimersByTime(6_000));
  expect(hook.result.current.stopping).toBe(true);
});

it('says why it failed and is ready at once', async () => {
  // A JSON-RPC rejection is a plain object.
  request.mockRejectedValueOnce({ code: -1, message: 'task is gone' });
  const hook = mount();
  await press(hook);
  expect(toast.error).toHaveBeenCalledWith('Could not stop “reviewer”', { description: 'task is gone' });
  expect(hook.result.current.stopping).toBe(false);
});
