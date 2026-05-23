import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildCaptureLikes,
  submitCapturesDirect,
  type PendingCaptureInput,
  type CaptureLike,
} from '../send-captures-direct.js';

function makeDeferredSend() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const send = vi.fn((_captures: ReadonlyArray<CaptureLike>) => {
    return new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return { send, resolve: () => resolve(), reject: (err: unknown) => reject(err) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildCaptureLikes', () => {
  it('maps pending captures to CaptureLike, trimming annotations and omitting blanks', () => {
    const pending: PendingCaptureInput[] = [
      { id: 'a', dataUrl: 'd1', annotation: '  x  ' },
      { id: 'b', dataUrl: 'd2', annotation: '   ' },
    ];

    expect(buildCaptureLikes(pending)).toEqual([
      { id: 'a', type: 'screenshot', imageDataUrl: 'd1', annotation: 'x' },
      { id: 'b', type: 'screenshot', imageDataUrl: 'd2' },
    ]);
  });
});

describe('submitCapturesDirect', () => {
  it('does nothing when pending is empty', () => {
    const onSuccess = vi.fn();
    const { send } = makeDeferredSend();

    submitCapturesDirect([], { onSuccess }, send);

    expect(send).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('delegates to the sender with the built captures and calls onSuccess on resolve', async () => {
    const onSuccess = vi.fn();
    const deferred = makeDeferredSend();
    const pending: PendingCaptureInput[] = [{ id: 'a', dataUrl: 'd1', annotation: '  x  ' }];

    submitCapturesDirect(pending, { onSuccess }, deferred.send);

    expect(deferred.send).toHaveBeenCalledOnce();
    expect(deferred.send).toHaveBeenCalledWith([{ id: 'a', type: 'screenshot', imageDataUrl: 'd1', annotation: 'x' }]);
    expect(onSuccess).not.toHaveBeenCalled();

    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does NOT call onSuccess on reject, logs tagged warning, and does not throw', async () => {
    const onSuccess = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deferred = makeDeferredSend();
    const pending: PendingCaptureInput[] = [{ id: 'a', dataUrl: 'd1', annotation: '' }];

    expect(() => submitCapturesDirect(pending, { onSuccess }, deferred.send)).not.toThrow();

    deferred.reject(new Error('network error'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[sandbox] direct capture send failed', expect.any(Error));

    warnSpy.mockRestore();
  });

  it('defaults the sender to sendCapturesDirect when not injected (no-active-chat path is sendCapturesDirect own concern)', () => {
    const onSuccess = vi.fn();
    expect(() => submitCapturesDirect([], { onSuccess })).not.toThrow();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
