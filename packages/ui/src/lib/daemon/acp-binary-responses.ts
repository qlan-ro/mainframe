/**
 * Completes JSON-RPC responses that announce their batches as binary frames
 * (`batchFrames: N`): holds each such response until its N frames are in,
 * inflates them natively, and hands back the result with `inflatedBatches` in
 * place of `batchFrames`. The connection owns the pending-request table; this
 * only asks it whether a request is still waiting and tells it how one ended.
 */
import { BinaryFrameAssembler } from './acp-binary-assembler';
import { inflateBinaryFrames, type BinaryFrame } from './acp-binary-frame';

export interface BinaryResponseHost<Entry> {
  /** Whether `entry` is still the request waiting under `key` (it may have timed out or the socket closed). */
  isWaiting(key: string, entry: Entry): boolean;
  succeed(key: string, entry: Entry, result: Record<string, unknown>): void;
  fail(key: string, error: unknown): void;
}

interface Parked<Entry> {
  entry: Entry;
  result: Record<string, unknown>;
  expected: number;
}

export class BinaryResponses<Entry> {
  private readonly frames = new BinaryFrameAssembler();
  private readonly parked = new Map<string, Parked<Entry>>();

  constructor(private readonly host: BinaryResponseHost<Entry>) {}

  /**
   * The response for `key` arrived: wait for (or take) its frames. Resolves
   * when the response has settled. Messages are held back only while frames
   * inflate, not while a response still waits for a late frame; the daemon
   * sends frames first, so that order is not expected in practice.
   */
  response(key: string, entry: Entry, result: Record<string, unknown>, expected: number): Promise<void> | undefined {
    const parked = { entry, result, expected };
    this.parked.set(key, parked);
    return this.complete(key, parked);
  }

  /** A frame for a request still waiting. Resolves when it completed the response. */
  frame(frame: BinaryFrame): Promise<void> | undefined {
    this.frames.add(frame);
    const parked = this.parked.get(frame.id);
    return parked ? this.complete(frame.id, parked) : undefined;
  }

  drop(key: string): void {
    this.parked.delete(key);
    this.frames.discard(key);
  }

  clear(): void {
    this.parked.clear();
    this.frames.clear();
  }

  private complete(key: string, parked: Parked<Entry>): Promise<void> | undefined {
    const frames = this.frames.take(key, parked.expected);
    if (!frames) return undefined;
    this.parked.delete(key);
    const { entry, result } = parked;
    return inflateBinaryFrames(frames).then(
      (inflatedBatches) => {
        if (!this.host.isWaiting(key, entry)) return;
        const settled: Record<string, unknown> = { ...result, inflatedBatches };
        delete settled.batchFrames;
        this.host.succeed(key, entry, settled);
      },
      (error: unknown) => this.host.fail(key, error),
    );
  }
}

/** The `batchFrames` count a result announces, or `undefined` for a result in the text form. */
export function batchFrameCount(result: unknown): number | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const count = (result as { batchFrames?: unknown }).batchFrames;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined;
}
