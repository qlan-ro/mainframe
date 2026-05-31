// packages/e2e/plugins/mock-cli/src/session.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  createReplayState,
  drainOutputs,
  consumeInput,
  isExhausted,
  type ReplayState,
  type RecordedEvent,
} from './fixture';

function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class ReplaySession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'mock-cli';
  readonly projectPath: string;
  private sink: SessionSink | undefined;
  private spawned = false;
  private readonly state: ReplayState;
  private lastDelay = 0;

  constructor(options: SessionOptions, dir: string, key: string, index: number) {
    this.id = options.mainframeChatId;
    this.projectPath = options.projectPath;
    const file = join(dir, `${sanitizeKey(key)}.${index}.ndjson`);
    if (!existsSync(file)) {
      throw new Error(`mock-cli: fixture not found: ${file} — record it with E2E_MODE=record`);
    }
    this.state = createReplayState(readFileSync(file, 'utf-8'));
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
      this.sink?.onError(
        new Error(
          `mock-cli: expected an '${expected}' marker but the fixture had '${marker?.method ?? 'nothing (exhausted)'}' — ` +
            `the test drives a different interaction order than was recorded. Re-record.`,
        ),
      );
      return;
    }
    this.lastDelay = marker.delayMs;
    this.emit(drainOutputs(this.state));
  }

  private emit(batch: RecordedEvent[]): void {
    if (!this.sink || batch.length === 0) return;
    const sink = this.sink as unknown as Record<string, (...args: unknown[]) => void>;
    const base = this.lastDelay;
    for (const ev of batch) {
      const offset = Math.max(0, ev.delayMs - base);
      const fire = () => sink[ev.method]?.(...ev.args);
      if (offset > 0) setTimeout(fire, offset);
      else fire();
    }
    const last = batch[batch.length - 1];
    if (last) this.lastDelay = last.delayMs;
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
  async loadHistory(): Promise<ChatMessage[]> {
    return [];
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
