/**
 * The binary WebSocket frame that carries one compressed batch of a history
 * response (`binaryHistoryFrames`, see docs/API-REFERENCE.md). Layout, in
 * bytes: version (1), encoding (1 = zlib-deflated JSON array of
 * `session/update` payloads), index (2), total (2), update count (2), id
 * length (2), then the request id (UTF-8) and the compressed payload; all
 * numbers big-endian. Mirrors `mainframe-acp/src/binary_frame.rs`.
 *
 * Inflating uses the platform's `DecompressionStream`, so the bytes never pass
 * through a JavaScript inflater or base64, and `Response.text()` decodes the
 * UTF-8 natively.
 */
import type { InflatedBatch } from '@qlan-ro/mainframe-types';

export const BINARY_FRAME_VERSION = 1;
export const BINARY_FRAME_ENCODING_ZLIB = 1;
const FIXED_HEADER_BYTES = 10;

export interface BinaryFrame {
  /** The request id the frame answers, as text. */
  id: string;
  index: number;
  total: number;
  /** How many updates the payload holds. */
  count: number;
  payload: Uint8Array;
}

/** Whether this runtime can inflate a frame; a client without it must not opt in. */
export function canInflateBinaryFrames(): boolean {
  return typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined';
}

/** The frame in `data`, or `undefined` for one too short, of an unknown version or encoding, or with a lying id length. */
export function parseBinaryFrame(data: ArrayBuffer | ArrayBufferView): BinaryFrame | undefined {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  if (bytes.length < FIXED_HEADER_BYTES) return undefined;
  if (bytes[0] !== BINARY_FRAME_VERSION || bytes[1] !== BINARY_FRAME_ENCODING_ZLIB) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idEnd = FIXED_HEADER_BYTES + view.getUint16(8);
  if (idEnd > bytes.length) return undefined;
  let id: string;
  try {
    id = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(FIXED_HEADER_BYTES, idEnd));
  } catch {
    return undefined;
  }
  return {
    id,
    index: view.getUint16(2),
    total: view.getUint16(4),
    count: view.getUint16(6),
    payload: bytes.subarray(idEnd),
  };
}

/** One frame's updates, parsed but not yet validated. Rejects on a bad stream or a payload that is not a JSON array. */
export async function inflateBinaryFrame(frame: BinaryFrame): Promise<InflatedBatch> {
  const inflated = new Blob([frame.payload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const updates: unknown = JSON.parse(await new Response(inflated).text());
  if (!Array.isArray(updates)) throw new Error('binary history frame did not inflate to an array');
  return { count: frame.count, updates };
}

/** Inflate a response's frames, which run in parallel off the main thread, back in index order. */
export function inflateBinaryFrames(frames: BinaryFrame[]): Promise<InflatedBatch[]> {
  return Promise.all(frames.map(inflateBinaryFrame));
}
