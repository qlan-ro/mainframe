/**
 * RED phase (Group `clipboard-core-tests`): `../copy-image` does not exist
 * yet. Every case below fails on module resolution until Group `clipboard-lib`
 * adds it — that failure, and only that failure, is expected here.
 *
 * `../write-image` is mocked; per D11 `copy-image.ts` does no host/source-kind
 * checking of its own (that gate is `canCopyImage`'s), so no DOM is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from '../copy-image';
import { writeImageToClipboard } from '../write-image';

vi.mock('../write-image');

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const mockedWrite = vi.mocked(writeImageToClipboard);

describe('copyImageToClipboard', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves { ok: true } and forwards src unchanged as the only argument', async () => {
    mockedWrite.mockResolvedValue(undefined);

    const result = await copyImageToClipboard(PNG_DATA_URI);

    expect(mockedWrite.mock.calls[0]).toEqual([PNG_DATA_URI]);
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('calls writeImageToClipboard synchronously, before the returned promise settles', () => {
    mockedWrite.mockResolvedValue(undefined);

    const promise = copyImageToClipboard(PNG_DATA_URI);

    expect(mockedWrite).toHaveBeenCalledTimes(1);
    return promise;
  });

  it('turns a synchronous throw into a failure result and logs one tagged warning', async () => {
    mockedWrite.mockImplementation(() => {
      throw new Error('bad source');
    });

    const result = await copyImageToClipboard(PNG_DATA_URI);

    expect(result).toEqual({ ok: false, message: 'bad source' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('[copy-image]');
  });

  it('turns a rejection into a failure result and logs one tagged warning', async () => {
    mockedWrite.mockRejectedValue(new Error('boom'));

    const result = await copyImageToClipboard(PNG_DATA_URI);

    expect(result).toEqual({ ok: false, message: 'boom' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('produces a non-empty message for a non-Error rejection', async () => {
    mockedWrite.mockRejectedValue('nope');

    const result = await copyImageToClipboard(PNG_DATA_URI);

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});
