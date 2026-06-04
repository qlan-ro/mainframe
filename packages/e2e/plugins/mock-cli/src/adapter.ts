// packages/e2e/plugins/mock-cli/src/adapter.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, AdapterModel, AdapterSession, SessionOptions } from '@qlan-ro/mainframe-types';
import { ReplaySession } from './session';
import { createReplayState, type RecordedEvent } from './fixture';

function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class MockCliAdapter implements Adapter {
  id = 'mock-cli';
  name = 'Mock CLI';
  readonly capabilities = { planMode: true };
  private readonly indexByKey = new Map<string, number>();
  // Cache each live session's events keyed by its recorded sessionId (from onInit), so the extra
  // createSession that getMessagesFromDisk does (passing chatId) reuses the same events for
  // loadHistory instead of consuming the next fixture index.
  private readonly eventsBySessionId = new Map<string, RecordedEvent[]>();
  // Fallback for a history/resume read whose chatId isn't a recorded sessionId (Mainframe may set
  // claudeSessionId to a value the fixture didn't capture): reuse the most recent live session.
  private lastLiveEvents: RecordedEvent[] | null = null;

  async isInstalled(): Promise<boolean> {
    return true;
  }
  async getVersion(): Promise<string | null> {
    return '0.1.0';
  }
  async listModels(): Promise<AdapterModel[]> {
    return [
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Haiku 4.5',
        isDefault: true,
        // No capability fields — effort/features controls hide for this model.
      },
      {
        id: 'claude-sonnet-4-5-20251101',
        label: 'Sonnet 4.5',
        supportedEfforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'medium',
        supportsFast: true,
      },
      {
        id: 'claude-opus-4-5-20251001',
        label: 'Opus 4.5',
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        supportsFast: true,
        supportsUltracode: true,
        supportsAdaptiveThinking: true,
      },
    ];
  }
  killAll(): void {}

  createSession(options: SessionOptions): AdapterSession {
    // A history/resume read (getMessagesFromDisk) passes chatId. Reuse the matching cached session,
    // or fall back to the most recent live one — never advance the per-key index or load a new file.
    if (options.chatId) {
      const events = this.eventsBySessionId.get(options.chatId) ?? this.lastLiveEvents;
      if (events) return new ReplaySession(options, events);
    }

    const dir = process.env['E2E_RECORDINGS_DIR'];
    if (!dir) throw new Error('mock-cli requires E2E_RECORDINGS_DIR');
    const key = process.env['E2E_RECORDING_KEY'] ?? 'session';
    const index = this.indexByKey.get(key) ?? 0;
    this.indexByKey.set(key, index + 1);

    const file = join(dir, `${sanitizeKey(key)}.${index}.ndjson`);
    if (!existsSync(file)) {
      throw new Error(`mock-cli: fixture not found: ${file} — record it with E2E_MODE=record`);
    }
    const events = createReplayState(readFileSync(file, 'utf-8')).events;
    this.lastLiveEvents = events;

    // Cache by recorded sessionId (the onInit arg) for later history reads.
    const sessionId = events.find((e) => e.dir === 'out' && e.method === 'onInit')?.args[0];
    if (typeof sessionId === 'string') this.eventsBySessionId.set(sessionId, events);

    return new ReplaySession(options, events);
  }
}
