// packages/e2e/plugins/mock-cli/src/adapter.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  AgentConfig,
  Skill,
  SessionOptions,
  ToolCategories,
} from '@qlan-ro/mainframe-types';
import { ReplaySession } from './session';
import { createReplayState, type RecordedEvent } from './fixture';
import { listSkills as scanSkills, listAgents as scanAgents } from './skills';

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

  /**
   * Tool categorization so the display pipeline groups explore/progress/subagent tool calls the
   * same way it does for the real `claude` adapter (`prepareMessagesForClient` no-ops entirely
   * without this — see packages/core/src/messages/display-pipeline.ts). Mirrors Claude's
   * `explore`/`progress`/`subagent` sets exactly (packages/core/src/plugins/builtin/claude/
   * adapter.ts). `hidden` is deliberately left EMPTY rather than mirrored: Claude hides
   * AskUserQuestion/TodoWrite/EnterPlanMode raw tool cards, but tool-cards.spec.ts's already-
   * committed "AskUserQuestion display card" test relies on today's uncategorized (visible)
   * behavior — hiding it here would silently break that test. TaskCreate/TaskUpdate don't need to
   * be in `hidden` either: groupToolCallParts checks `progress` before `hidden`, so they're
   * captured into `_task_progress` regardless.
   */
  getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Read', 'Glob', 'Grep', 'LS']),
      hidden: new Set(),
      progress: new Set(['TaskCreate', 'TaskUpdate']),
      subagent: new Set(['Task', 'Agent']),
    };
  }

  /** Project-scope only (no homedir scan) — see skills.ts. Lets a recording/e2e project that
   *  seeds `.claude/skills|agents` populate the Skills/Agents panels under mock-cli. */
  async listSkills(projectPath: string): Promise<Skill[]> {
    return scanSkills(projectPath);
  }
  async listAgents(projectPath: string): Promise<AgentConfig[]> {
    return scanAgents(projectPath);
  }

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
