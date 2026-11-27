/** The binary frame header, its golden fixture shared with the daemon, and native inflate. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canInflateBinaryFrames, inflateBinaryFrame, parseBinaryFrame } from '../acp-binary-frame';
import { binaryFrame, deflateBatch } from './support/synthetic-history';

const GOLDEN = new URL(
  '../../../../../core-rs/crates/mainframe-types/tests/fixtures/acp/binary-frame.golden.hex',
  import.meta.url,
);

describe('parseBinaryFrame', () => {
  it('reads the daemon golden frame', () => {
    const bytes = Uint8Array.from(
      readFileSync(GOLDEN, 'utf8')
        .trim()
        .split(/\s+/)
        .map((hex) => parseInt(hex, 16)),
    );
    const frame = parseBinaryFrame(bytes.buffer)!;
    expect(frame).toMatchObject({ id: '17', index: 1, total: 4, count: 3 });
    expect([...frame.payload]).toEqual([0x78, 0x01, 0xaa, 0xbb]);
  });

  it('rejects short, unknown-version, unknown-encoding and lying-id frames', () => {
    const good = new Uint8Array(binaryFrame('1', 0, 1, 0, new Uint8Array([1])));
    expect(parseBinaryFrame(good.slice(0, 9).buffer)).toBeUndefined();
    expect(parseBinaryFrame(Uint8Array.from(good, (b, i) => (i === 0 ? 2 : b)).buffer)).toBeUndefined();
    expect(parseBinaryFrame(Uint8Array.from(good, (b, i) => (i === 1 ? 9 : b)).buffer)).toBeUndefined();
    expect(parseBinaryFrame(Uint8Array.from(good, (b, i) => (i === 9 ? 200 : b)).buffer)).toBeUndefined();
    expect(parseBinaryFrame(new ArrayBuffer(0))).toBeUndefined();
  });

  it('rejects an id that is not UTF-8', () => {
    const bad = new Uint8Array(binaryFrame('ab', 0, 1, 0, new Uint8Array([1])));
    bad[10] = 0xff;
    expect(parseBinaryFrame(bad.buffer)).toBeUndefined();
  });
});

describe('inflateBinaryFrame', () => {
  it('inflates a payload with the platform decoder', async () => {
    expect(canInflateBinaryFrames()).toBe(true);
    const updates = [{ sessionUpdate: 'usage_update', used: 1, size: 2 }, { note: 'héllo ✓' }];
    const frame = parseBinaryFrame(binaryFrame('1', 0, 1, 2, deflateBatch(updates)))!;
    await expect(inflateBinaryFrame(frame)).resolves.toEqual({ count: 2, updates });
  });

  it('rejects a corrupt stream, a truncated stream and a payload that is not an array', async () => {
    const good = deflateBatch([{ a: 1 }]);
    const corrupt = Uint8Array.from(good, (b, i) => (i === 4 ? b ^ 0xff : b));
    for (const payload of [corrupt, good.slice(0, good.length - 3), deflateBatch([]).slice(0, 2)]) {
      await expect(inflateBinaryFrame(parseBinaryFrame(binaryFrame('1', 0, 1, 1, payload))!)).rejects.toBeDefined();
    }
    const object = new Uint8Array((await import('node:zlib')).deflateSync(Buffer.from('{"a":1}')));
    await expect(inflateBinaryFrame(parseBinaryFrame(binaryFrame('1', 0, 1, 1, object))!)).rejects.toThrow(/array/);
  });
});
