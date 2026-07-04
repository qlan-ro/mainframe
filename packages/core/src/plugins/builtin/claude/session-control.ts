import { nanoid } from 'nanoid';
import type { ChildProcess } from 'node:child_process';
import type { Logger } from 'pino';

type Raw = Record<string, unknown> | undefined;

/**
 * One correlation channel per session for control_request/control_response round-trips.
 * Fire-and-forget callers use send(); awaiting callers use sendAwaiting(). A single
 * pending map is drained by events.ts via resolve(), and by session close via drainAllAsFailed().
 */
interface Pending {
  /** When provided, resolve() fulfills only on a response the predicate accepts — intermediate acks are ignored. */
  isTerminal?: (raw: Raw) => boolean;
  done: (raw: Raw) => void;
}

export class ControlRequestChannel {
  private pending = new Map<string, Pending>();
  constructor(
    private readonly log: Logger,
    private readonly sessionId: string,
  ) {}

  send(stdin: ChildProcess['stdin'], request: Record<string, unknown>): string {
    const requestId = nanoid();
    stdin?.write(JSON.stringify({ type: 'control_request', request_id: requestId, request }) + '\n');
    return requestId;
  }

  sendAwaiting(
    stdin: ChildProcess['stdin'],
    request: Record<string, unknown>,
    opts: { label: string; timeoutMs?: number; isTerminal?: (raw: Raw) => boolean },
  ): Promise<Raw> {
    const requestId = this.send(stdin, request);
    return new Promise<Raw>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.log.warn(
          { sessionId: this.sessionId, requestId, label: opts.label },
          `${opts.label} control_response timed out`,
        );
        resolve(undefined);
      }, opts.timeoutMs ?? 5_000);
      this.pending.set(requestId, {
        isTerminal: opts.isTerminal,
        done: (raw) => {
          clearTimeout(timer);
          resolve(raw);
        },
      });
    });
  }

  /**
   * Route a control_response to its awaiting caller. Returns false when unmatched
   * (e.g. context-usage) or when the response is a non-terminal intermediate ack the
   * caller's predicate rejects — in that case the caller keeps waiting.
   */
  resolve(requestId: string, raw: Raw): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (entry.isTerminal && !entry.isTerminal(raw)) return false; // intermediate ack — keep waiting
    this.pending.delete(requestId);
    entry.done(raw);
    return true;
  }

  /** Fail every pending caller when the session dies, so no awaiter hangs forever. */
  drainAllAsFailed(): void {
    for (const entry of this.pending.values()) entry.done(undefined);
    this.pending.clear();
  }
}
