// packages/e2e/plugins/mock-cli/src/session.ts
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  AdapterProcess,
  AdapterSession,
  ChatMessage,
  ContextFile,
  ControlResponse,
  SessionOptions,
  SessionSink,
  SessionSpawnOptions,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import {
  drainOutputs,
  consumeInput,
  isExhausted,
  messagesFromEvents,
  type ReplayState,
  type RecordedEvent,
} from './fixture';

export class ReplaySession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'mock-cli';
  readonly projectPath: string;
  private sink: SessionSink | undefined;
  private spawned = false;
  private readonly state: ReplayState;
  private lastDelay = 0;

  /** `events` are pre-parsed by MockCliAdapter (which also caches them by recorded sessionId). */
  constructor(options: SessionOptions, events: RecordedEvent[]) {
    this.id = options.mainframeChatId;
    this.projectPath = options.projectPath;
    this.state = { events, cursor: 0 };
  }

  get isSpawned(): boolean {
    return this.spawned;
  }

  async spawn(_options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
    this.spawned = true;
    this.sink = sink;
    // Leading outputs only (usually none — onInit arrives after the first message).
    this.emit(drainOutputs(this.state));
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.id,
      pid: -1,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async sendMessage(): Promise<void> {
    this.advance('sendMessage');
  }
  async respondToPermission(_response: ControlResponse): Promise<void> {
    this.advance('respondToPermission');
  }
  async interrupt(): Promise<void> {
    this.advance('interrupt');
  }

  /**
   * Consume this interaction's `in` marker (which must match `expected` — markers are the
   * synchronization contract) and emit the run of outputs that followed it. The first output's
   * delay is based off the marker, so recorded think-time between turns is not replayed.
   */
  private advance(expected: string): void {
    const marker = isExhausted(this.state) ? null : consumeInput(this.state);
    if (!marker || marker.method !== expected) {
      // Distinguish exhaustion from a mid-turn desync (cursor sitting on an `out` event).
      const had = marker
        ? `'${marker.method}'`
        : isExhausted(this.state)
          ? 'nothing (fixture exhausted)'
          : `an out-event ('${this.state.events[this.state.cursor]?.method}') — fixture is mid-turn`;
      this.sink?.onError(
        new Error(
          `mock-cli: expected an '${expected}' marker but the fixture had ${had} — ` +
            `the test drives a different interaction order than was recorded. Re-record.`,
        ),
      );
      return;
    }
    this.lastDelay = marker.delayMs;
    // Coalesce consecutive same-method in-markers: one UI action can drive multiple session calls in
    // the recording with no outputs between them (e.g. plan approval → respondToPermission twice).
    // The test issues one action, so consume the duplicates here. Distinct responses always have
    // `out` events between their markers, so this never merges genuinely separate interactions.
    let next = this.state.events[this.state.cursor];
    while (next && next.dir === 'in' && next.method === expected) {
      consumeInput(this.state);
      next = this.state.events[this.state.cursor];
    }
    this.emit(drainOutputs(this.state));
  }

  // Cap per-event replay delay: keep a brief gap so intermediate states (e.g. "Thinking") still
  // render, but never replay the AI's real multi-second latency — that would blow past Playwright's
  // per-test timeout on multi-turn specs (e.g. plan approval).
  private static readonly MAX_DELAY_MS = 120;

  private emit(batch: RecordedEvent[]): void {
    if (batch.length === 0) return;
    const sink = this.sink as unknown as Record<string, (...args: unknown[]) => void> | undefined;
    const base = this.lastDelay;
    for (const ev of batch) {
      if (ev.dir === 'fx') {
        this.applyFx(ev); // apply file effects synchronously so real git assertions see them
        continue;
      }
      if (!sink) continue;
      const offset = Math.min(Math.max(0, ev.delayMs - base), ReplaySession.MAX_DELAY_MS);
      const fire = () => sink[ev.method]?.(...ev.args);
      if (offset > 0) setTimeout(fire, offset);
      else fire();
    }
    const last = batch[batch.length - 1];
    if (last) this.lastDelay = last.delayMs;
  }

  /** Reproduce recorded workspace file changes on disk (so real `git`-based assertions pass). */
  private applyFx(ev: RecordedEvent): void {
    for (const f of ev.files ?? []) {
      const abs = join(this.projectPath, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    for (const rel of ev.deleted ?? []) {
      rmSync(join(this.projectPath, rel), { force: true });
    }
  }

  // ── Interface no-ops (irrelevant to replay) ───────────────────────────────
  async kill(): Promise<void> {
    this.spawned = false;
  }
  getProcessInfo(): AdapterProcess | null {
    return this.spawned
      ? {
          id: this.id,
          adapterId: this.adapterId,
          chatId: this.id,
          pid: -1,
          status: 'ready',
          projectPath: this.projectPath,
        }
      : null;
  }
  async cancelQueuedMessage(): Promise<boolean> {
    return false;
  }
  async setModel(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  async setPlanMode(): Promise<void> {}
  async sendCommand(): Promise<void> {}
  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }
  /** Reconstruct messages from the recorded events so getMessagesFromDisk → extractSessionFilePaths
   *  (the "session" Changes mode) sees the agent's Write/Edit tool_use blocks. Tool-use file paths
   *  are recorded as record-time absolute paths; remap them onto this run's project dir (test
   *  projects are always `…/mf-e2e-<id>/…`) so the file list + diff-viewer resolve correctly. */
  async loadHistory(): Promise<ChatMessage[]> {
    const root = this.projectPath.replace(/\/$/, '');
    const remap = (p: string): string => p.replace(/^.*\/mf-e2e-[^/]+\//, root + '/');
    return messagesFromEvents(this.state.events).map((m) => ({
      role: m.role,
      content: (m.content as Array<Record<string, unknown>>).map((b) => {
        const input = b?.['input'] as Record<string, unknown> | undefined;
        if (b?.['type'] === 'tool_use' && typeof input?.['file_path'] === 'string') {
          return { ...b, input: { ...input, file_path: remap(input['file_path'] as string) } };
        }
        return b;
      }),
    })) as unknown as ChatMessage[];
  }
  async extractPlanFiles(): Promise<string[]> {
    return [];
  }
  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    return [];
  }
  async stopBackgroundTask(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'unsupported' };
  }
}
