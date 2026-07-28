// @vitest-environment jsdom
/**
 * RED phase (Group `clipboard-core-tests`): `../write-image` does not exist
 * yet. Every case below fails on module resolution until Group `clipboard-lib`
 * adds it — that failure, and only that failure, is expected here.
 *
 * `write` adopts the ClipboardItem's `image/png` value (rather than ignoring
 * it) so a rejecting re-encode surfaces through the promise
 * `writeImageToClipboard` returns instead of orphaning as an unhandled
 * rejection — see plan Task 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeImageToClipboard } from '../write-image';

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTE_LENGTH = 70;
const JPEG_DATA_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';
const BAD_PNG_DATA_URI = 'data:image/png;base64,!!!';

class FakeClipboardItem {
  constructor(readonly values: Record<string, Blob | Promise<Blob>>) {}
}

async function copiedBlob(write: ReturnType<typeof vi.fn>): Promise<Blob> {
  const item = write.mock.calls[0]![0][0] as FakeClipboardItem;
  return item.values['image/png']!;
}

describe('writeImageToClipboard', () => {
  let write: ReturnType<typeof vi.fn>;
  let seenSrc: string;

  beforeEach(() => {
    seenSrc = '';
    write = vi.fn(async (items: FakeClipboardItem[]) => {
      await items[0]!.values['image/png'];
    });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', { clipboard: { write } });

    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      seenSrc = this.src;
      return Promise.resolve();
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(2);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
  });

  it('writes decoded PNG bytes directly, without touching the canvas', async () => {
    const createElementSpy = vi.spyOn(document, 'createElement');

    await writeImageToClipboard(PNG_DATA_URI);

    expect(write).toHaveBeenCalledTimes(1);
    const blob = await copiedBlob(write);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(PNG_BYTE_LENGTH);
    expect(createElementSpy).not.toHaveBeenCalledWith('canvas');
  });

  it('calls navigator.clipboard.write synchronously, before the returned promise settles', () => {
    const promise = writeImageToClipboard(PNG_DATA_URI);

    expect(write).toHaveBeenCalledTimes(1);
    return promise;
  });

  it('re-encodes a non-PNG source through a canvas and still writes synchronously', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(new Blob(['fake-png-bytes'], { type: 'image/png' })),
    );
    const atobSpy = vi.spyOn(globalThis, 'atob');

    const promise = writeImageToClipboard(JPEG_DATA_URI);
    expect(write).toHaveBeenCalledTimes(1);
    await promise;

    const blob = await copiedBlob(write);
    expect(blob.type).toBe('image/png');
    expect(seenSrc).toBe(JPEG_DATA_URI);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(atobSpy).not.toHaveBeenCalled();
  });

  it('rejects when the image fails to decode', async () => {
    HTMLImageElement.prototype.decode = vi.fn(() => Promise.reject(new Error('decode failed')));

    await expect(writeImageToClipboard(JPEG_DATA_URI)).rejects.toThrow('decode failed');
  });

  it('rejects when the canvas has no 2d context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(writeImageToClipboard(JPEG_DATA_URI)).rejects.toThrow();
  });

  it('rejects when the canvas cannot produce a blob', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(null));

    await expect(writeImageToClipboard(JPEG_DATA_URI)).rejects.toThrow();
  });

  it('throws synchronously for a malformed PNG source, without calling navigator.clipboard.write', () => {
    expect(() => writeImageToClipboard(BAD_PNG_DATA_URI)).toThrow(/.+/);
    expect(write).not.toHaveBeenCalled();
  });
});
