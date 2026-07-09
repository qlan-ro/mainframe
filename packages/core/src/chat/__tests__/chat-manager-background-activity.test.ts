import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chat, ControlRequest } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../../db/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import type { PermissionManager } from '../permission-manager.js';
import { ChatManager } from '../chat-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';

function makeDb(chats: Array<Partial<Chat> & { id: string }>): DatabaseManager {
  const store = new Map<string, Partial<Chat> & { id: string }>(chats.map((c) => [c.id, { ...c }]));
  return {
    chats: {
      get: (id: string) => (store.get(id) ?? null) as Chat | null,
      listAll: () => [...store.values()] as Chat[],
      list: vi.fn().mockReturnValue([]),
      listFiltered: vi.fn().mockReturnValue([]),
      update: vi.fn(),
      resetWorkingToIdle: vi.fn().mockReturnValue(0),
    },
    projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
    settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
  } as unknown as DatabaseManager;
}

function makeAdapters(): AdapterRegistry {
  return {
    get: vi.fn().mockReturnValue(undefined),
    all: vi.fn().mockReturnValue([]),
  } as unknown as AdapterRegistry;
}

function startTask(
  tracker: BackgroundTaskTracker,
  chatId: string,
  id: string,
  kind: 'bash' | 'agent' | 'workflow',
  description = 'work',
) {
  tracker.start(chatId, { id, kind, toolName: 'Bash', toolUseId: `tu-${id}`, command: 'cmd', description }, `/p/${id}`);
}

describe('ChatManager enrichChat — backgroundActivity derivation', () => {
  let tracker: BackgroundTaskTracker;
  let manager: ChatManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    tracker = new BackgroundTaskTracker();
    manager = new ChatManager(
      makeDb([
        { id: 'c-idle', projectId: 'p1', processState: 'idle' },
        { id: 'c-working', projectId: 'p1', processState: 'working' },
      ]),
      makeAdapters(),
      tracker,
    );
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it('main-only: working processState, no background → working, isRunning, no backgroundActivity', () => {
    const chat = manager.getChat('c-working')!;
    expect(chat.displayStatus).toBe('working');
    expect(chat.isRunning).toBe(true);
    expect(chat.backgroundActivity).toBeUndefined();
  });

  it('background-only: idle processState + live tasks → working, NOT isRunning, activity payload', () => {
    startTask(tracker, 'c-idle', 'a-1', 'agent', 'reviewer');
    startTask(tracker, 'c-idle', 'b-1', 'bash', 'dev server');

    const chat = manager.getChat('c-idle')!;
    expect(chat.displayStatus).toBe('working');
    expect(chat.isRunning).toBe(false);
    expect(chat.backgroundActivity).toEqual({
      total: 2,
      byKind: { agent: 1, bash: 1 },
      tasks: [
        { id: 'a-1', kind: 'agent', description: 'reviewer', startedAt: 5000 },
        { id: 'b-1', kind: 'bash', description: 'dev server', startedAt: 5000 },
      ],
    });
  });

  it('both main turn and background → working with activity', () => {
    startTask(tracker, 'c-working', 'w-1', 'workflow', 'deploy');
    const chat = manager.getChat('c-working')!;
    expect(chat.displayStatus).toBe('working');
    expect(chat.isRunning).toBe(true);
    expect(chat.backgroundActivity).toEqual({
      total: 1,
      byKind: { workflow: 1 },
      tasks: [{ id: 'w-1', kind: 'workflow', description: 'deploy', startedAt: 5000 }],
    });
  });

  it('terminal tasks do not count: idle with only ended tasks → idle, no activity', () => {
    startTask(tracker, 'c-idle', 'a-2', 'agent');
    tracker.end('c-idle', 'a-2', { status: 'completed', outputPath: '', summary: '', usage: null });

    const chat = manager.getChat('c-idle')!;
    expect(chat.displayStatus).toBe('idle');
    expect(chat.backgroundActivity).toBeUndefined();
  });

  it('pending permission wins over background activity → waiting', () => {
    startTask(tracker, 'c-idle', 'a-3', 'agent');
    const permissions = (manager as unknown as { permissions: PermissionManager }).permissions;
    permissions.enqueue('c-idle', { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu', input: {} } as ControlRequest);

    const chat = manager.getChat('c-idle')!;
    expect(chat.displayStatus).toBe('waiting');
    expect(chat.isRunning).toBe(false);
    // The chip still shows the live background work while the gate is up.
    expect(chat.backgroundActivity?.total).toBe(1);
  });
});
