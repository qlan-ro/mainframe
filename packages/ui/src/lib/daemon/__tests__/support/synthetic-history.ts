/**
 * Deterministic synthetic history pages for protocol tests and the decode
 * bench. No transcript content: every string is built from a fixed word list
 * by a seeded generator, shaped like the daemon's `session/update` payloads
 * (messages, tool calls with large text results, diffs, usage).
 */
import { deflateSync } from 'node:zlib';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'const',
  'return',
  'async',
  'await',
  'function',
  'import',
  'export',
  'value',
  'result',
  'index',
  'items',
  'error',
  'status',
  'config',
  'handler',
  'buffer',
  'stream',
  'socket',
  'frame',
  'batch',
  'update',
  'render',
];

function text(random: () => number, bytes: number): string {
  const parts: string[] = [];
  let length = 0;
  while (length < bytes) {
    const line = Array.from({ length: 4 + Math.floor(random() * 8) }, () => WORDS[Math.floor(random() * WORDS.length)]);
    const row = `${String(Math.floor(random() * 9999)).padStart(4, '0')}  ${line.join('_')}(${line.length});\n`;
    parts.push(row);
    length += row.length;
  }
  return parts.join('').slice(0, bytes);
}

/** About `targetBytes` of uncompressed JSON across mixed update kinds, in replay order. */
export function syntheticUpdates(
  targetBytes: number,
  seed = 1,
  resultBytes: [number, number] = [20_000, 80_000],
): SessionUpdate[] {
  const random = rng(seed);
  const updates: SessionUpdate[] = [];
  let size = 0;
  for (let n = 0; size < targetBytes; n++) {
    const batch: SessionUpdate[] = [
      { sessionUpdate: 'user_message', messageId: `u${n}`, content: [{ type: 'text', text: text(random, 200) }] },
      { sessionUpdate: 'agent_message', messageId: `a${n}`, content: [{ type: 'text', text: text(random, 1500) }] },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: `t${n}`,
        title: 'Read file',
        kind: 'read',
        status: 'completed',
        locations: [{ path: `src/mod${n}.ts`, line: n % 200 }],
        rawInput: { file_path: `src/mod${n}.ts`, limit: 2000 },
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: text(random, resultBytes[0] + Math.floor(random() * (resultBytes[1] - resultBytes[0]))),
            },
          },
        ],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: `e${n}`,
        title: 'Edit file',
        kind: 'edit',
        status: 'completed',
        content: [
          {
            type: 'diff',
            changes: [{ operation: 'modify', path: `src/mod${n}.ts` }],
            patch: { format: 'git_patch', text: text(random, Math.min(3000, resultBytes[1])) },
          },
        ],
      },
      { sessionUpdate: 'usage_update', used: 1000 + n, size: 200_000 },
    ];
    for (const update of batch) {
      updates.push(update);
      size += JSON.stringify(update).length;
    }
  }
  return updates;
}

/** Batches of at most 256 updates, as the daemon cuts them. */
export function chunked<T>(items: T[], size = 256): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** zlib at the daemon's fast level, the payload both encodings carry. */
export function deflateBatch(updates: unknown[]): Uint8Array {
  return new Uint8Array(deflateSync(Buffer.from(JSON.stringify(updates)), { level: 1 }));
}

/** Today's text form: base64 batches inside a JSON-RPC response frame. */
export function legacyResponseFrame(id: number, sessionId: string, updates: SessionUpdate[]): string {
  const batches = chunked(updates).map((batch) => ({
    sessionId,
    encoding: 'deflate+base64',
    count: batch.length,
    data: Buffer.from(deflateBatch(batch)).toString('base64'),
  }));
  return JSON.stringify({ jsonrpc: '2.0', id, result: { batches, hasMore: true, floorItemId: 'm0' } });
}

/** A binary history frame as the daemon writes it (see `acp-binary-frame.ts`). */
export function binaryFrame(id: string, index: number, total: number, count: number, payload: Uint8Array): ArrayBuffer {
  const idBytes = new TextEncoder().encode(id);
  const out = new Uint8Array(10 + idBytes.length + payload.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = 1;
  view.setUint16(2, index);
  view.setUint16(4, total);
  view.setUint16(6, count);
  view.setUint16(8, idBytes.length);
  out.set(idBytes, 10);
  out.set(payload, 10 + idBytes.length);
  return out.buffer;
}

/** The frames for a response to request `id`: one per 256-update batch. */
export function binaryFramesFor(id: string, updates: SessionUpdate[]): ArrayBuffer[] {
  const batches = chunked(updates);
  return batches.map((batch, index) => binaryFrame(id, index, batches.length, batch.length, deflateBatch(batch)));
}

/** The binary response's JSON frame: `batchFrames` in place of `batches`. */
export function binaryResponseFrame(id: number, frames: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { batchFrames: frames, hasMore: true, floorItemId: 'm0', ...extra },
  });
}
