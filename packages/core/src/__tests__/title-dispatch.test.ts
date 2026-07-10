import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AdapterSession, ChatMessage, SessionOptions } from '@qlan-ro/mainframe-types';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { MockBaseAdapter } from './helpers/mock-adapter.js';
import { MockBaseSession } from './helpers/mock-session.js';

// Adapter-aware title generation: the LLM refine step must route through the
// chat's own adapter (`adapter.generateTitle`), never cross-spawn another
// vendor's CLI. Adapters that omit the method keep the deterministic title.

class MockSession extends MockBaseSession {
  constructor(adapterId: string, projectPath: string) {
    super('proc-1', adapterId, projectPath);
  }
  override async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }
}

class TitleAdapter extends MockBaseAdapter {
  override id = 'mock';
  override name = 'Mock';
  generateTitleFn?: (content: string, binary: string) => Promise<string | null>;

  override createSession(options: SessionOptions): AdapterSession {
    return new MockSession(this.id, options.projectPath);
  }

  generateTitle(content: string, binary: string): Promise<string | null> {
    if (!this.generateTitleFn) throw new Error('generateTitleFn not set');
    return this.generateTitleFn(content, binary);
  }
}

const chatId = 'test-chat';
const testProject = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

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

function createMockDb(settingsGetFn?: (...args: unknown[]) => unknown) {
  return {
    chats: {
      get: vi.fn().mockImplementation(() => freshChat()),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
    },
    projects: { get: vi.fn().mockReturnValue(testProject) },
    settings: { get: settingsGetFn ?? vi.fn().mockReturnValue(null) },
  };
}

function titleUpdates(db: ReturnType<typeof createMockDb>): string[] {
  return db.chats.update.mock.calls
    .filter((call) => 'title' in (call[1] as Record<string, unknown>))
    .map((call) => (call[1] as { title: string }).title);
}

describe('title generation dispatch (adapter-aware)', () => {
  let adapter: TitleAdapter;
  let registry: AdapterRegistry;

  beforeEach(() => {
    adapter = new TitleAdapter();
    registry = new AdapterRegistry();
    registry.register(adapter);
  });

  it("routes the LLM refine through the chat's own adapter.generateTitle", async () => {
    adapter.generateTitleFn = vi.fn().mockResolvedValue('Refined Title');
    const db = createMockDb();
    const manager = new ChatManager(db as never, registry, new BackgroundTaskTracker());

    await manager.sendMessage(chatId, 'Refactor the authentication module to use JWT tokens');

    await vi.waitFor(() => expect(titleUpdates(db).length).toBeGreaterThanOrEqual(2), { timeout: 2000 });

    expect(adapter.generateTitleFn).toHaveBeenCalledWith(
      'Refactor the authentication module to use JWT tokens',
      'claude',
    );
    const titles = titleUpdates(db);
    expect(titles[titles.length - 1]).toBe('Refined Title');
  });

  it('resolves the binary from the <adapterId>.titleBinary setting', async () => {
    adapter.generateTitleFn = vi.fn().mockResolvedValue('X');
    const settingsGet = vi.fn().mockImplementation((category: string, key: string) => {
      if (category === 'provider' && key === 'mock.titleBinary') return '/custom/bin';
      return null;
    });
    const db = createMockDb(settingsGet);
    const manager = new ChatManager(db as never, registry, new BackgroundTaskTracker());

    await manager.sendMessage(chatId, 'do a thing');

    await vi.waitFor(() => expect(adapter.generateTitleFn).toHaveBeenCalled(), { timeout: 2000 });
    expect(adapter.generateTitleFn).toHaveBeenCalledWith('do a thing', '/custom/bin');
  });

  it('keeps the deterministic title when the adapter omits generateTitle', async () => {
    const plain = new MockBaseAdapter((o) => new MockSession('plain', o.projectPath));
    plain.id = 'mock';
    const registry2 = new AdapterRegistry();
    registry2.register(plain);
    const db = createMockDb();
    const manager = new ChatManager(db as never, registry2, new BackgroundTaskTracker());

    await manager.sendMessage(chatId, 'Fix the login bug on mobile Safari');
    await new Promise((r) => setTimeout(r, 200));

    const titles = titleUpdates(db);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatch(/^Fix the login bug/);
  });
});
