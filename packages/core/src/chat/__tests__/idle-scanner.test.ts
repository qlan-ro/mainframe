import { describe, it, expect, vi } from 'vitest';
import { IdleSessionScanner } from '../idle-scanner.js';
import type { ActiveChat } from '../types.js';
import type { AdapterSession } from '@qlan-ro/mainframe-types';

function fakeSession(lastActivityAt: number, isSpawned = true): AdapterSession {
  return {
    id: 'sess',
    adapterId: 'claude',
    projectPath: '/tmp',
    isSpawned,
    lastActivityAt,
    kill: vi.fn().mockResolvedValue(undefined),
    // unused stubs
    spawn: vi.fn(),
    getProcessInfo: vi.fn(),
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    interrupt: vi.fn(),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
    setPlanMode: vi.fn(),
    sendCommand: vi.fn(),
    cancelQueuedMessage: vi.fn(),
    getContextFiles: vi.fn(),
    loadHistory: vi.fn(),
    extractPlanFiles: vi.fn(),
    extractSkillFiles: vi.fn(),
  } as unknown as AdapterSession;
}

describe('IdleSessionScanner', () => {
  it('evicts sessions idle longer than threshold', async () => {
    const now = 10_000_000;
    const thresholdMs = 2 * 60 * 60 * 1000;
    const idle = fakeSession(now - thresholdMs - 1);
    const active = fakeSession(now - 1000);
    const chats = new Map<string, ActiveChat>([
      ['idle-chat', { chat: { id: 'idle-chat' } as any, session: idle }],
      ['active-chat', { chat: { id: 'active-chat' } as any, session: active }],
    ]);

    const scanner = new IdleSessionScanner(chats, thresholdMs, 60_000, () => now);
    await scanner.scan();

    expect(idle.kill).toHaveBeenCalledTimes(1);
    expect(active.kill).not.toHaveBeenCalled();
  });

  it('skips sessions that are not spawned', async () => {
    const now = 10_000_000;
    const thresholdMs = 1000;
    const dead = fakeSession(now - 10_000, false);
    const chats = new Map<string, ActiveChat>([['dead', { chat: { id: 'dead' } as any, session: dead }]]);

    const scanner = new IdleSessionScanner(chats, thresholdMs, 60_000, () => now);
    await scanner.scan();

    expect(dead.kill).not.toHaveBeenCalled();
  });

  it('skips sessions without lastActivityAt tracking', async () => {
    const now = 10_000_000;
    const session = {
      id: 's',
      adapterId: 'codex',
      projectPath: '/tmp',
      isSpawned: true,
      kill: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdapterSession;
    const chats = new Map<string, ActiveChat>([['x', { chat: { id: 'x' } as any, session }]]);

    const scanner = new IdleSessionScanner(chats, 100, 60_000, () => now);
    await scanner.scan();

    expect(session.kill).not.toHaveBeenCalled();
  });
});
