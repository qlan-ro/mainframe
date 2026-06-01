// packages/core/src/testing/record-wrapper.ts
// Sync fs here is intentional and exempt from the "no sync I/O in server code" rule: this path runs
// only under E2E_MODE=record (never production), and synchronous appends keep each recorded event's
// `elapsed()` timestamp ordered without await races. Do not refactor to async — it would reorder events. /* expected */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Adapter,
  AdapterProcess,
  AdapterSession,
  SessionOptions,
  SessionSink,
  SessionSpawnOptions,
} from '@qlan-ro/mainframe-types';
import type { AdapterRegistry } from '../adapters/index.js';
import { createRecordingSink } from './recording-sink.js';
import { fixtureFileName, safeArgs, type RecordedEvent } from './recording-format.js';
import { captureProjectFx } from './capture-fx.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('e2e:record');

/** Per-session writer shared by the output sink and the input markers (one timeline via `elapsed`). */
interface Recorder {
  write: (event: RecordedEvent) => void;
  writeIn: (method: string, args: unknown[]) => void;
  elapsed: () => number;
}

// Daemon→session calls we record as `in` markers, so replay can split on the exact interaction cadence.
const INPUT_METHODS = new Set(['sendMessage', 'respondToPermission', 'interrupt']);

/**
 * Replaces the registered `claude` adapter with a Proxy that, per session,
 * (a) tees every sink output to an NDJSON fixture and (b) records an `in` marker
 * before each sendMessage/respondToPermission/interrupt. The fixture file is
 * truncated at session creation so re-recording (index resets to 0 each daemon
 * run) overwrites cleanly. Only called when E2E_MODE==='record' — production
 * never enters this path.
 */
export function wrapClaudeForRecording(adapters: AdapterRegistry): void {
  const real = adapters.get('claude');
  if (!real) {
    log.warn('No claude adapter registered — nothing to wrap for recording');
    return;
  }
  const dir = process.env['E2E_RECORDINGS_DIR'];
  if (!dir) throw new Error('E2E_MODE=record requires E2E_RECORDINGS_DIR');
  mkdirSync(dir, { recursive: true });

  const key = process.env['E2E_RECORDING_KEY'] ?? 'session';
  const indexByKey = new Map<string, number>();
  // Recorded sessionIds (from onInit). getMessagesFromDisk re-creates a session by sessionId for a
  // history read — pass those through unrecorded so they don't spawn junk fixtures.
  const recordedSessionIds = new Set<string>();

  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'createSession') {
        return (options: SessionOptions): AdapterSession => {
          if (options.chatId && recordedSessionIds.has(options.chatId)) {
            return target.createSession(options); // passive history read — don't record
          }
          const index = indexByKey.get(key) ?? 0;
          indexByKey.set(key, index + 1);
          const file = join(dir, fixtureFileName(key, index));
          writeFileSync(file, ''); // truncate any fixture from a previous record run
          const start = Date.now();
          const elapsed = () => Date.now() - start;
          const append = (e: RecordedEvent) => appendFileSync(file, JSON.stringify(e) + '\n');
          // After a tool result, snapshot the working tree so replay can reproduce file changes for
          // real git-based assertions (Changes tab "uncommitted"). Dedup consecutive identical sets.
          let lastFxJson = '';
          const write = (e: RecordedEvent) => {
            append(e);
            if (e.dir === 'out' && e.method === 'onInit' && typeof e.args[0] === 'string') {
              recordedSessionIds.add(e.args[0]);
            }
            if (e.dir === 'out' && (e.method === 'onToolResult' || e.method === 'onResult')) {
              const fx = captureProjectFx(options.projectPath);
              if (fx.files.length === 0 && fx.deleted.length === 0) return;
              const json = JSON.stringify(fx);
              if (json === lastFxJson) return;
              lastFxJson = json;
              append({ dir: 'fx', method: 'fx', args: [], delayMs: elapsed(), files: fx.files, deleted: fx.deleted });
            }
          };
          const recorder: Recorder = {
            write,
            elapsed,
            writeIn: (method, args) => append({ dir: 'in', method, args: safeArgs(args), delayMs: elapsed() }),
          };
          return wrapSession(target.createSession(options), recorder);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Adapter;

  adapters.register(wrapped);
  log.info({ key, dir }, 'Claude adapter wrapped for E2E recording');
}

function wrapSession(session: AdapterSession, rec: Recorder): AdapterSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === 'spawn') {
        return (options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> => {
          const recordingSink = sink ? createRecordingSink(sink, { write: rec.write, now: rec.elapsed }) : sink;
          return target.spawn(options, recordingSink);
        };
      }
      if (typeof prop === 'string' && INPUT_METHODS.has(prop)) {
        const orig = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>;
        return (...args: unknown[]): Promise<unknown> => {
          rec.writeIn(prop, args);
          return orig.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AdapterSession;
}
