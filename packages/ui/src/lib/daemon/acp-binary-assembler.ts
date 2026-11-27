/**
 * Pairs binary history frames with the JSON-RPC response they belong to. A
 * frame may arrive before or after its response, with other messages between
 * them, so frames are held by request id until the response says how many to
 * expect (`batchFrames`).
 */
import { type BinaryFrame } from './acp-binary-frame';

export class BinaryFrameAssembler {
  private readonly held = new Map<string, Map<number, BinaryFrame>>();

  /** Hold a frame; a repeated index for the same request is a protocol error. */
  add(frame: BinaryFrame): void {
    let frames = this.held.get(frame.id);
    if (!frames) {
      frames = new Map();
      this.held.set(frame.id, frames);
    }
    if (frames.has(frame.index)) throw new Error(`duplicate binary history frame ${frame.index}`);
    frames.set(frame.index, frame);
  }

  /**
   * The request's frames in index order once `expected` of them are here,
   * `undefined` while some are still to come. Throws when a held frame
   * contradicts the response: another total, or an index outside it.
   */
  take(id: string, expected: number): BinaryFrame[] | undefined {
    const frames = this.held.get(id);
    for (const frame of frames?.values() ?? []) {
      if (frame.total !== expected || frame.index >= expected) {
        throw new Error(`binary history frame ${frame.index}/${frame.total} does not match ${expected} expected`);
      }
    }
    if (!frames || frames.size < expected) return undefined;
    this.held.delete(id);
    return [...frames.values()].sort((a, b) => a.index - b.index);
  }

  discard(id: string): void {
    this.held.delete(id);
  }

  clear(): void {
    this.held.clear();
  }
}
