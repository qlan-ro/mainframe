import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import { BaseSession } from '../adapters/base-session.js';
import type {
  ChatMessage,
  AdapterProcess,
  SessionOptions,
  SessionSpawnOptions,
  AdapterSession,
  DaemonEvent,
} from '@mainframe/types';

// ── Mock adapter & DB (infrastructure, not what we're testing) ──────

class MockSession extends BaseSession {
  readonly id = 'proc-1';
  readonly adapterId: string;
  readonly projectPath: string;
  private _isSpawned = false;

  constructor(adapterId: string, projectPath: string) {
    super();
    this.adapterId = adapterId;
    this.projectPath = projectPath;
  }

  get isSpawned(): boolean {
    return this._isSpawned;
  }

  async spawn(_options?: SessionSpawnOptions): Promise<AdapterProcess> {
    this._isSpawned = true;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: '',
      pid: 0,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async kill(): Promise<void> {
    this._isSpawned = false;
  }

  getProcessInfo(): AdapterProcess | null {
    return this._isSpawned
      ? { id: this.id, adapterId: this.adapterId, chatId: '', pid: 0, status: 'ready', projectPath: this.projectPath }
      : null;
  }

  override async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }
}

class MockAdapter extends BaseAdapter {
  id = 'mock';
  name = 'Mock';
  currentSession: MockSession | null = null;

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0';
  }

  override createSession(options: SessionOptions): AdapterSession {
    this.currentSession = new MockSession(this.id, options.projectPath);
    return this.currentSession;
  }
}

const chatId = 'test-chat';

function freshChat() {
  return {
    id: chatId,
    adapterId: 'mock',
    projectId: 'proj-1',
    claudeSessionId: 'session-1',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
  };
}

const testProject = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

function createMockDb(settingsGetFn?: (...args: unknown[]) => unknown) {
  return {
    chats: {
      get: vi.fn().mockImplementation(() => freshChat()),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
    },
    projects: {
      get: vi.fn().mockReturnValue(testProject),
    },
    settings: {
      get: settingsGetFn ?? vi.fn().mockReturnValue(null),
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function titleUpdates(db: ReturnType<typeof createMockDb>): string[] {
  return db.chats.update.mock.calls
    .filter(([_id, data]: [string, Record<string, unknown>]) => 'title' in data)
    .map(([_id, data]: [string, { title: string }]) => data.title);
}

function collectEvents(manager: ChatManager): DaemonEvent[] {
  const events: DaemonEvent[] = [];
  manager.on('event', (e: DaemonEvent) => events.push(e));
  return events;
}

// ── Tests ────────────────────────────────────────────────────────────
// These are integration tests — they actually call `claude -p` via the CLI.
// Requires `claude` to be installed and authenticated.

describe.skipIf(!!process.env.CI)('generateTitle (integration — real claude -p calls)', () => {
  let adapter: MockAdapter;
  let registry: AdapterRegistry;

  beforeEach(() => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    registry = new AdapterRegistry();
    registry.register(adapter);
  });

  it('generates a concise LLM title that replaces the truncated one', async () => {
    const db = createMockDb();
    const manager = new ChatManager(db as any, registry);
    const events = collectEvents(manager);

    await manager.sendMessage(
      chatId,
      'Refactor the authentication module to use JWT tokens instead of session cookies',
    );

    // Wait for the async LLM title to arrive (real API call)
    await vi.waitFor(
      () => {
        expect(titleUpdates(db).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 35_000 },
    );

    const titles = titleUpdates(db);

    // First title: truncated (set immediately)
    expect(titles[0]).toMatch(/^Refactor the authentication/);
    expect(titles[0].length).toBeLessThanOrEqual(51); // 50 + ellipsis

    // Second title: LLM-generated (concise, not a truncation)
    const llmTitle = titles[1];
    expect(llmTitle.length).toBeGreaterThanOrEqual(2);
    expect(llmTitle.length).toBeLessThanOrEqual(80);
    // Should be shorter/different than the raw truncated message
    expect(llmTitle).not.toEqual(titles[0]);
    // Should not be the full original message
    expect(llmTitle.length).toBeLessThan(60);

    // UI should have received multiple chat.updated events
    const chatUpdates = events.filter((e) => e.type === 'chat.updated');
    expect(chatUpdates.length).toBeGreaterThanOrEqual(2);
  }, 40_000);

  it('produces a relevant title for different types of tasks', async () => {
    const db = createMockDb();
    const manager = new ChatManager(db as any, registry);

    await manager.sendMessage(chatId, 'Fix the bug where the login button does not respond to clicks on mobile Safari');

    await vi.waitFor(
      () => {
        expect(titleUpdates(db).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 35_000 },
    );

    const llmTitle = titleUpdates(db)[1];
    // Title should exist and be reasonable length
    expect(llmTitle.length).toBeGreaterThanOrEqual(2);
    expect(llmTitle.length).toBeLessThanOrEqual(80);
  }, 40_000);

  it('does not call LLM when title generation is disabled', async () => {
    const settingsGet = vi.fn().mockImplementation((category: string, key: string) => {
      if (category === 'general' && key === 'titleGeneration.disabled') return 'true';
      return null;
    });
    const db = createMockDb(settingsGet);
    const manager = new ChatManager(db as any, registry);

    await manager.sendMessage(chatId, 'This should not trigger LLM');
    // Give it time — if LLM were called it would take seconds
    await new Promise((r) => setTimeout(r, 2000));

    // Only the truncated title, no LLM title
    expect(titleUpdates(db)).toHaveLength(1);
  }, 10_000);

  it('does not regenerate title on subsequent messages', async () => {
    const db = createMockDb();
    const manager = new ChatManager(db as any, registry);

    await manager.sendMessage(chatId, 'First message about authentication');

    await vi.waitFor(
      () => {
        expect(titleUpdates(db).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 35_000 },
    );

    const titlesAfterFirst = titleUpdates(db).length;

    // Send second message — should NOT trigger title generation
    await manager.sendMessage(chatId, 'Now do something completely different about databases');
    await new Promise((r) => setTimeout(r, 2000));

    // No new title updates
    expect(titleUpdates(db).length).toBe(titlesAfterFirst);
  }, 45_000);
});
