/**
 * image-source — decode `data:image/*` URIs and gate which sources this
 * host can copy to the clipboard. Pure; no clipboard or canvas writes here.
 */

const COPYABLE_SRC = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

export interface DecodedDataUrl {
  mediaType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Decodes a `data:image/*;base64,...` URI; `null` for anything it can't parse. */
export function decodeDataUrl(src: string): DecodedDataUrl | null {
  const match = COPYABLE_SRC.exec(src);
  if (!match) return null;

  const comma = src.indexOf(',');
  const base64 = src.slice(comma + 1);
  const mediaType = src.slice('data:'.length, src.indexOf(';'));

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mediaType, bytes };
  } catch {
    // Malformed base64 is data, not a fault — the caller treats null as "not copyable".
    return null;
  }
}

/** Whether this webview exposes the async Clipboard API's image write. */
export function imageClipboardSupported(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator?.clipboard?.write === 'function';
}

/** The single gate: `src` is a copyable data URI AND the host can write images. */
export function canCopyImage(src: string): boolean {
  return COPYABLE_SRC.test(src) && imageClipboardSupported();
}
