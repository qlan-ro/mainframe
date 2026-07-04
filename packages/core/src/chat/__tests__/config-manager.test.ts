import { describe, it, expect, vi } from 'vitest';
import { ChatConfigManager, type ConfigManagerDeps } from '../config-manager.js';
import type { Chat, AdapterSession } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from '../types.js';

function baseChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    model: 'old-model',
    permissionMode: 'default',
    ...overrides,
  } as Chat;
}

function fakeDeps(active: ActiveChat, overrides: Partial<ConfigManagerDeps> = {}): ConfigManagerDeps {
  return {
    adapters: {} as any,
    db: { chats: { update: vi.fn() }, settings: { get: vi.fn() } } as any,
    startingChats: new Map(),
    getActiveChat: () => active,
    startChat: vi.fn(),
    stopChat: vi.fn(),
    emitEvent: vi.fn(),
    applyTuning: vi.fn(),
    ...overrides,
  };
}

describe('ChatConfigManager.updateChatConfig — independent apply', () => {
  it('persists permissionMode even when setModel rejects', async () => {
    const session: Partial<AdapterSession> = {
      isSpawned: true,
      setModel: vi.fn().mockRejectedValue(new Error('set_model failed: timeout')),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
    };
    const active: ActiveChat = { chat: baseChat(), session: session as AdapterSession };
    const deps = fakeDeps(active);
    const manager = new ChatConfigManager(deps);

    await manager.updateChatConfig('c1', undefined, 'new-model', 'acceptEdits', undefined);

    expect(session.setModel).toHaveBeenCalledWith('new-model');
    expect(session.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(deps.db.chats.update).toHaveBeenCalledWith('c1', { permissionMode: 'acceptEdits' });
    expect(active.chat.model).toBe('old-model'); // rejected — not applied
    expect(active.chat.permissionMode).toBe('acceptEdits'); // succeeded — applied
    expect(deps.applyTuning).not.toHaveBeenCalled(); // model didn't actually change
    expect(deps.emitEvent).toHaveBeenCalledWith({ type: 'chat.updated', chat: active.chat });
  });

  it('does not persist or emit when every setting rejects', async () => {
    const session: Partial<AdapterSession> = {
      isSpawned: true,
      setModel: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const active: ActiveChat = { chat: baseChat(), session: session as AdapterSession };
    const deps = fakeDeps(active);
    const manager = new ChatConfigManager(deps);

    await manager.updateChatConfig('c1', undefined, 'new-model', undefined, undefined);

    expect(deps.db.chats.update).not.toHaveBeenCalled();
    expect(deps.emitEvent).not.toHaveBeenCalled();
  });
});
