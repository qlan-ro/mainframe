/**
 * RED phase (Group `clipboard-core-tests`): `../image-source` does not exist
 * yet. Every case below fails on module resolution until Group `clipboard-lib`
 * adds it — that failure, and only that failure, is expected here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canCopyImage, decodeDataUrl, imageClipboardSupported } from '../image-source';

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_BYTE_LENGTH = 70;
const JPEG_DATA_URI = 'data:image/jpeg;base64,AAAA';

describe('decodeDataUrl', () => {
  it('decodes a PNG data URI to its media type and raw bytes', () => {
    const decoded = decodeDataUrl(PNG_DATA_URI);

    expect(decoded).not.toBeNull();
    expect(decoded!.mediaType).toBe('image/png');
    expect(Array.from(decoded!.bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);
    expect(decoded!.bytes.length).toBe(PNG_BYTE_LENGTH);
  });

  it('returns null for a non-base64 data URI', () => {
    expect(decodeDataUrl('data:image/svg+xml,<svg/>')).toBeNull();
  });

  it('returns null for a non-image data URI', () => {
    expect(decodeDataUrl('data:text/plain;base64,aGVsbG8=')).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(decodeDataUrl('data:image/png;base64,!!!')).toBeNull();
  });
});

describe('imageClipboardSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false when ClipboardItem is not defined', () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });

    expect(imageClipboardSupported()).toBe(false);
  });

  it('is false when ClipboardItem exists but navigator.clipboard.write does not', () => {
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: {} });

    expect(imageClipboardSupported()).toBe(false);
  });

  it('is true when both ClipboardItem and navigator.clipboard.write exist', () => {
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });

    expect(imageClipboardSupported()).toBe(true);
  });
});

describe('canCopyImage', () => {
  const COPYABLE_SOURCES: Array<[string, string]> = [
    ['data:image/png', PNG_DATA_URI],
    ['data:image/jpeg', JPEG_DATA_URI],
  ];
  const NOT_COPYABLE_SOURCES: Array<[string, string]> = [
    ['http', 'http://example.com/image.png'],
    ['https', 'https://example.com/image.png'],
    ['file', 'file:///Users/x/image.png'],
    ['blob', 'blob:https://example.com/1234-uuid'],
    ['asset', 'asset://localhost/image.png'],
    ['empty string', ''],
    ['non-image data URI', 'data:text/plain;base64,aGVsbG8='],
  ];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('when the host has no image-clipboard support', () => {
    beforeEach(() => {
      vi.stubGlobal('navigator', { clipboard: {} });
    });

    it.each([...COPYABLE_SOURCES, ...NOT_COPYABLE_SOURCES])('%s is not copyable: %s', (_label, src) => {
      expect(canCopyImage(src)).toBe(false);
    });
  });

  describe('when the host supports image-clipboard writes', () => {
    beforeEach(() => {
      vi.stubGlobal('ClipboardItem', class {});
      vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    });

    it.each(COPYABLE_SOURCES)('%s is copyable', (_label, src) => {
      expect(canCopyImage(src)).toBe(true);
    });

    it.each(NOT_COPYABLE_SOURCES)('%s is not copyable', (_label, src) => {
      expect(canCopyImage(src)).toBe(false);
    });
  });
});
