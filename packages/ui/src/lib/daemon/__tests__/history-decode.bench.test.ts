/**
 * Decode-plus-validate timing for a large history response, text form (base64
 * batches, JS inflate, plain-union validation, as before binary frames) against
 * binary frames (platform inflate, tagged-union validation). Opt in with
 * `MF_BENCH=1`; it prints medians and asserts nothing about speed.
 *   MF_BENCH=1 pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
 *     src/lib/daemon/__tests__/history-decode.bench.test.ts --disableConsoleIntercept
 */
import { describe, it } from 'vitest';
import { z } from 'zod';
import { strFromU8, unzlibSync } from 'fflate';
import { HistoryPageResultSchema, SessionUpdateSchema } from '@qlan-ro/mainframe-types';
import { inflateBinaryFrames, parseBinaryFrame } from '../acp-binary-frame';
import { validateBatchUpdates } from '../acp-replay-batch';
import {
  binaryFramesFor,
  binaryResponseFrame,
  chunked,
  legacyResponseFrame,
  syntheticUpdates,
} from './support/synthetic-history';

const RUNS = Number(process.env.MF_BENCH_RUNS ?? 9);
const SIZES_MB = (process.env.MF_BENCH_MB ?? '1,6,13').split(',').map(Number);
const SCENARIOS: Record<string, [number, number]> = {
  'large results (20-80 KB each)': [20_000, 80_000],
  'many small results (0.2-2 KB each)': [200, 2_000],
};

/** The union as it was before the tagged version: every shape tried in turn. */
const flat = (schema: z.ZodType): z.ZodType[] => {
  const options = (schema as unknown as { options?: z.ZodType[] }).options;
  return options ? options.flatMap(flat) : [schema];
};
const PlainUnion = z.union(flat(SessionUpdateSchema) as [z.ZodType, z.ZodType]);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const ms = (value: number) => value.toFixed(1).padStart(6);

function legacyDecode(frame: string) {
  const t0 = performance.now();
  const message = JSON.parse(frame) as { result: unknown };
  const page = HistoryPageResultSchema.parse(message.result);
  const t1 = performance.now();
  const inflated = page.batches!.map((batch) => {
    const binary = atob(batch.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return JSON.parse(strFromU8(unzlibSync(bytes))) as unknown[];
  });
  const t2 = performance.now();
  let count = 0;
  for (const batch of inflated) for (const entry of batch) count += PlainUnion.safeParse(entry).success ? 1 : 0;
  const t3 = performance.now();
  return { count, parse: t1 - t0, decode: t2 - t1, validate: t3 - t2, total: t3 - t0 };
}

async function binaryDecode(frames: ArrayBuffer[], response: string) {
  const t0 = performance.now();
  const message = JSON.parse(response) as { result: unknown };
  HistoryPageResultSchema.parse(message.result);
  const parsed = frames.map((frame) => parseBinaryFrame(frame)!);
  const t1 = performance.now();
  const batches = await inflateBinaryFrames(parsed);
  const t2 = performance.now();
  let count = 0;
  for (const batch of batches) count += validateBatchUpdates(batch.updates, batch.count).length;
  const t3 = performance.now();
  return { count, parse: t1 - t0, decode: t2 - t1, validate: t3 - t2, total: t3 - t0 };
}

describe.skipIf(!process.env.MF_BENCH)('history decode bench', () => {
  for (const [scenario, resultBytes] of Object.entries(SCENARIOS)) {
    for (const mb of SIZES_MB) {
      it(`${scenario}, ${mb} MB`, { timeout: 120_000 }, async () => {
        const updates = syntheticUpdates(mb * 1_000_000, 1, resultBytes);
        const raw = JSON.stringify(updates).length;
        const text = legacyResponseFrame(1, 'chat_1', updates);
        const frames = binaryFramesFor('1', updates);
        const response = binaryResponseFrame(1, frames.length);
        const wire = frames.reduce((sum, frame) => sum + frame.byteLength, 0) + response.length;
        legacyDecode(text);
        await binaryDecode(frames, response);
        const before = Array.from({ length: RUNS }, () => legacyDecode(text));
        const after: Awaited<ReturnType<typeof binaryDecode>>[] = [];
        for (let run = 0; run < RUNS; run++) after.push(await binaryDecode(frames, response));
        const col = (rows: typeof before, key: 'parse' | 'decode' | 'validate' | 'total') =>
          ms(median(rows.map((r) => r[key])));
        // eslint-disable-next-line no-console -- the bench's only output
        console.log(
          `${scenario}, ${mb} MB: ${updates.length} updates in ${chunked(updates).length} batches, raw ${(raw / 1e6).toFixed(2)} MB; ` +
            `wire text ${(text.length / 1e6).toFixed(2)} MB, binary ${(wire / 1e6).toFixed(2)} MB\n` +
            `  text   (base64+fflate+union): total ${col(before, 'total')} ms = envelope ${col(before, 'parse')} + decode ${col(before, 'decode')} + validate ${col(before, 'validate')}\n` +
            `  binary (native+tagged):       total ${col(after, 'total')} ms = envelope ${col(after, 'parse')} + decode ${col(after, 'decode')} + validate ${col(after, 'validate')}  (${before[0]!.count}/${after[0]!.count} valid)`,
        );
      });
    }
  }
});
