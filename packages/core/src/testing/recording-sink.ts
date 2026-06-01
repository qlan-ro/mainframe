// packages/core/src/testing/recording-sink.ts
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { safeArgs, type RecordedEvent } from './recording-format.js';

export interface RecordingSinkDeps {
  write: (event: RecordedEvent) => void;
  /** Returns ms elapsed since session start. Shared with the `in`-marker writer so all events
   *  sit on one timeline (lets replay base each output's delay off the preceding `in` marker). */
  now: () => number;
}

/**
 * Wraps a real SessionSink in a Proxy. Every method call is recorded as
 * {dir:'out', method, args, delayMs} and then forwarded to the real sink. Generic: any
 * present or future sink method is captured with no code change.
 */
export function createRecordingSink(real: SessionSink, deps: RecordingSinkDeps): SessionSink {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop === 'string' && typeof orig === 'function') {
        return (...args: unknown[]): unknown => {
          deps.write({ dir: 'out', method: prop, args: safeArgs(args), delayMs: deps.now() });
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return orig;
    },
  });
}
