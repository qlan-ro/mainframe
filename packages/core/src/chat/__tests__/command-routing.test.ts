import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatManager } from '../index.js';
import { wrapMainframeCommand } from '../../commands/wrap.js';
import { MockBaseSession } from '../../__tests__/helpers/mock-session.js';
import { MockBaseAdapter } from '../../__tests__/helpers/mock-adapter.js';
import type { AdapterSession, SessionOptions } from '@mainframe/types';

// ── wrapMainframeCommand unit tests ──────────────────────────────────────────

describe('wrapMainframeCommand', () => {
  it('wraps content in mainframe command tags', () => {
    const result = wrapMainframeCommand('init', '/init', 'some args');
    expect(result).toContain('<mainframe-command name="init"');
    expect(result).toContain('some args');
    expect(result).toContain('<mainframe-command-response');
    expect(result).toContain('</mainframe-command>');
  });

  it('generates a unique command id', () => {
    const r1 = wrapMainframeCommand('init', '/init');
    const r2 = wrapMainframeCommand('init', '/init');
    const idMatch1 = r1.match(/id="(cmd_[^"]+)"/);
    const idMatch2 = r2.match(/id="(cmd_[^"]+)"/);
    expect(idMatch1![1]).not.toBe(idMatch2![1]);
  });

  it('uses args as template when provided', () => {
    const result = wrapMainframeCommand('greet', '/greet', 'Say hello');
    expect(result).toContain('Say hello');
  });

  it('uses empty string as template when args are omitted', () => {
    const result = wrapMainframeCommand('noop', '/noop');
    expect(result).toContain('<mainframe-command name="noop"');
    expect(result).toContain('</mainframe-command>');
  });
});

// ── ChatManager command routing integration tests ─────────────────────────────

const TEST_CHAT = {
  id: 'chat-1',
  adapterId: 'mock',
  projectId: 'proj-1',
  status: 'active',
  claudeSessionId: null,
  processState: 'idle',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  title: 'Test chat',
};

const TEST_PROJECT = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

function createMockDb() {
  return {
    chats: {
      get: vi.fn().mockReturnValue(TEST_CHAT),
      create: vi.fn().mockReturnValue(TEST_CHAT),
      list: vi.fn().mockReturnValue([TEST_CHAT]),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
      getMentions: vi.fn().mockReturnValue([]),
      getModifiedFilesList: vi.fn().mockReturnValue([]),
      getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]),
      addModifiedFile: vi.fn().mockReturnValue(false),
    },
    projects: {
      get: vi.fn().mockReturnValue(TEST_PROJECT),
      list: vi.fn().mockReturnValue([TEST_PROJECT]),
      getByPath: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      remove: vi.fn(),
      updateLastOpened: vi.fn(),
    },
    settings: {
      get: vi.fn().mockReturnValue(null),
      getByCategory: vi.fn().mockReturnValue({}),
    },
  };
}

class TrackingSession extends MockBaseSession {
  sendMessageCalls: string[] = [];
  sendCommandCalls: Array<{ command: string; args?: string }> = [];

  override async sendMessage(message: string): Promise<void> {
    this.sendMessageCalls.push(message);
  }

  override async sendCommand(command: string, args?: string): Promise<void> {
    this.sendCommandCalls.push({ command, args });
  }
}

class TrackingAdapter extends MockBaseAdapter {
  override id = 'mock';
  session: TrackingSession | null = null;

  override createSession(_options: SessionOptions): AdapterSession {
    this.session = new TrackingSession('sess-1', 'mock', '/tmp/test');
    return this.session;
  }
}

function createManager(adapter: TrackingAdapter) {
  const db = createMockDb();
  const registry = { get: vi.fn().mockReturnValue(adapter), all: vi.fn().mockReturnValue([adapter]) } as any;
  const manager = new ChatManager(db as any, registry, undefined, () => {});

  // Pre-seed an active spawned session so sendMessage doesn't try to spawn
  const session = adapter.createSession({ projectPath: '/tmp/test' }) as TrackingSession;
  void session.spawn();
  (manager as any).activeChats.set('chat-1', {
    chat: { ...TEST_CHAT },
    session,
  });

  return { manager, session, db };
}

describe('ChatManager command routing', () => {
  let adapter: TrackingAdapter;

  beforeEach(() => {
    adapter = new TrackingAdapter();
  });

  it('calls sendCommand when source is a provider (e.g. claude)', async () => {
    const { manager, session } = createManager(adapter);

    await manager.sendMessage('chat-1', '/compact', undefined, {
      command: { name: 'compact', source: 'claude', args: undefined },
    });

    expect(session.sendCommandCalls).toHaveLength(1);
    expect(session.sendCommandCalls[0]!.command).toBe('compact');
    expect(session.sendMessageCalls).toHaveLength(0);
  });

  it('calls sendCommand with args when provided', async () => {
    const { manager, session } = createManager(adapter);

    await manager.sendMessage('chat-1', '/init --scope project', undefined, {
      command: { name: 'init', source: 'claude', args: '--scope project' },
    });

    expect(session.sendCommandCalls).toHaveLength(1);
    expect(session.sendCommandCalls[0]!.command).toBe('init');
    expect(session.sendCommandCalls[0]!.args).toBe('--scope project');
  });

  it('calls sendMessage with wrapped content when source is mainframe', async () => {
    const { manager, session } = createManager(adapter);

    await manager.sendMessage('chat-1', '/greet', undefined, {
      command: { name: 'greet', source: 'mainframe', args: 'Say hello' },
    });

    expect(session.sendMessageCalls).toHaveLength(1);
    expect(session.sendMessageCalls[0]).toContain('<mainframe-command name="greet"');
    expect(session.sendMessageCalls[0]).toContain('Say hello');
    expect(session.sendMessageCalls[0]).toContain('<mainframe-command-response');
    expect(session.sendCommandCalls).toHaveLength(0);
  });

  it('updates processState to working after command routing', async () => {
    const { manager, db } = createManager(adapter);

    await manager.sendMessage('chat-1', '/compact', undefined, {
      command: { name: 'compact', source: 'claude' },
    });

    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { processState: 'working' });
  });

  it('calls plain sendMessage with raw content when no metadata is provided', async () => {
    const { manager, session } = createManager(adapter);

    await manager.sendMessage('chat-1', 'Hello world');

    expect(session.sendMessageCalls).toHaveLength(1);
    expect(session.sendMessageCalls[0]).toBe('Hello world');
    expect(session.sendCommandCalls).toHaveLength(0);
  });
});
