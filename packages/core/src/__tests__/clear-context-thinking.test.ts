import { describe, it, expect, vi } from 'vitest';
import type { ControlResponse, DaemonEvent, SessionSink } from '@qlan-ro/mainframe-types';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { ClaudePlanModeHandler } from '../plugins/builtin/claude/plan-mode-handler.js';
import type { PlanActionContext } from '../chat/plan-mode-actions.js';
import type { ActiveChat } from '../chat/types.js';

/**
 * Regression test for the Thinking-indicator race after approving a plan with
 * "Clear Context".
 *
 * Historical bug:
 *   1. User approves plan → ClaudePlanModeHandler.onApproveAndClearContext runs.
 *   2. Old CLI process is killed, a new session is spawned via startChat().
 *   3. sendMessage() flips the chat to processState='working' (Thinking indicator).
 *   4. The OLD process's 'close' event arrives LATE and hits the old session's
 *      sink.onExit(), which cleared processState → Thinking indicator vanished.
 *
 * Fix (Tasks 14 + 15):
 *   - session.kill() now awaits the 'close' event (Task 14) — but a close can
 *     still race past the await on some platforms.
 *   - buildSink captures `builtForSessionId`; onExit becomes a no-op when the
 *     active session has been superseded (Task 15).
 *
 * This test exercises the full flow: ClaudePlanModeHandler drives a real
 * EventHandler + MessageCache + PermissionManager stack, the fake session's
 * kill() awaits a close promise we control, and we fire the stale onExit AFTER
 * sendMessage() has set processState='working'.
 */

interface FakeSession {
  id: string;
  isSpawned: boolean;
  setPermissionMode: ReturnType<typeof vi.fn>;
  respondToPermission: ReturnType<typeof vi.fn>;
  kill: () => Promise<void>;
  resolveClose: () => void;
}

function createFakeSession(id: string): FakeSession {
  let resolveClose: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  return {
    id,
    isSpawned: true,
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    // Mirror claude session.kill(): resolves only after the 'close' event fires.
    kill: () => closed,
    resolveClose: () => resolveClose(),
  };
}

function createDbStub() {
  return {
    chats: {
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      get: vi.fn(),
    },
  };
}

function createActiveChat(chatId: string, session: FakeSession | null): ActiveChat {
  const chat = {
    id: chatId,
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active' as const,
    createdAt: '',
    updatedAt: '',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    planMode: true,
    permissionMode: 'acceptEdits' as const,
    processState: 'working' as const,
  };
  return { chat, session: session as unknown as ActiveChat['session'] };
}

describe('clear-context approve: Thinking indicator stays on', () => {
  it('kill() resolves only after close; subsequent processState=working survives stale onExit', async () => {
    const chatId = 'chat-clear-ctx';
    const oldSession = createFakeSession('session-old');

    const active = createActiveChat(chatId, oldSession);
    const activeChats = new Map<string, ActiveChat>([[chatId, active]]);

    const messages = new MessageCache();
    const permissions = new PermissionManager();
    const db = createDbStub();
    const emitted: DaemonEvent[] = [];
    const emitEvent = (event: DaemonEvent): void => {
      emitted.push(event);
    };

    const handler = new EventHandler(
      db as unknown as Parameters<typeof EventHandler.prototype.buildSink> extends never ? never : any,
      messages,
      permissions,
      (id) => activeChats.get(id),
      emitEvent,
    );

    // Build the sink bound to the OLD session id — this is what the daemon does
    // when it spawns the old process. We hold a reference to it so we can fire
    // its onExit later (simulating the late-arriving 'close' event).
    const oldSink: SessionSink = handler.buildSink(chatId, oldSession.id, vi.fn());

    // startChat(): swap the old session for a new one, keep processState='working'.
    const newSession = createFakeSession('session-new');
    const startChat = vi.fn(async (id: string) => {
      const a = activeChats.get(id);
      if (!a) return;
      a.session = newSession as unknown as ActiveChat['session'];
      a.chat.processState = 'working';
    });

    // sendMessage(): after Clear-Context the user's original request isn't
    // replayed, but sendMessage is what flips the Thinking indicator back on.
    // We keep it minimal — assert it only sets processState to 'working'.
    const sendMessage = vi.fn(async (id: string) => {
      const a = activeChats.get(id);
      if (!a) return;
      a.chat.processState = 'working';
    });

    const ctx: PlanActionContext = {
      chatId,
      active,
      chat: active.chat,
      db: db as unknown as PlanActionContext['db'],
      messages,
      permissions,
      emitEvent,
      clearDisplayCache: vi.fn(),
      startChat,
      sendMessage,
    };

    const response: ControlResponse = {
      requestId: 'req-1',
      toolUseId: 'tu-1',
      behavior: 'allow',
      toolName: 'ExitPlanMode',
      executionMode: 'acceptEdits',
      updatedInput: { plan: 'Do the thing.' },
    };

    // Drive the approve + clear-context flow. onApproveAndClearContext awaits
    // oldSession.kill() — which won't resolve until we fire resolveClose().
    // So we kick it off, let it sit on the await, then resolve.
    const flow = new ClaudePlanModeHandler().onApproveAndClearContext(response, ctx);

    // Let the handler reach `await oldSession.kill()`.
    await Promise.resolve();

    // Fire the 'close' event → kill() resolves → the handler continues.
    oldSession.resolveClose();
    await flow;

    // Preconditions after the flow finishes:
    //   - startChat and sendMessage both ran (simulating a fresh session
    //     carrying the "Thinking" indicator).
    //   - The active session has been swapped to 'session-new'.
    //   - processState is 'working'.
    expect(startChat).toHaveBeenCalledWith(chatId);
    expect(sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Do the thing.'));
    expect(activeChats.get(chatId)?.session?.id).toBe('session-new');
    expect(active.chat.processState).toBe('working');

    // Clear the DB update spy so we can isolate what (if anything) the stale
    // onExit mutates.
    db.chats.update.mockClear();
    const beforeEventsLen = emitted.length;

    // NOW simulate the OLD process's late-arriving 'close' event. Without the
    // session-identity guard in buildSink, this clears processState and emits
    // chat.updated, dropping the Thinking indicator.
    oldSink.onExit(0);

    // The guard should have made onExit a no-op because active.session.id
    // ('session-new') !== builtForSessionId ('session-old').
    expect(active.chat.processState).toBe('working');

    // The stale close must not have emitted a chat.updated event, nor written
    // processState=null to the DB.
    const newEvents = emitted.slice(beforeEventsLen);
    expect(newEvents.find((e) => e.type === 'chat.updated')).toBeUndefined();
    expect(db.chats.update).not.toHaveBeenCalledWith(chatId, expect.objectContaining({ processState: null }));
  });

  it('positive case: onExit from the current session still clears processState', () => {
    // Sanity check: the guard only suppresses stale close events. A 'close'
    // from the session the sink was built for must still mark the chat idle.
    const chatId = 'chat-positive';
    const session = createFakeSession('session-a');
    const active = createActiveChat(chatId, session);
    const activeChats = new Map<string, ActiveChat>([[chatId, active]]);

    const messages = new MessageCache();
    const permissions = new PermissionManager();
    const db = createDbStub();
    const emitted: DaemonEvent[] = [];

    const handler = new EventHandler(
      db as unknown as Parameters<typeof EventHandler.prototype.buildSink> extends never ? never : any,
      messages,
      permissions,
      (id) => activeChats.get(id),
      (event) => emitted.push(event),
    );
    const sink: SessionSink = handler.buildSink(chatId, 'session-a', vi.fn());

    sink.onExit(0);

    expect(active.chat.processState).toBeNull();
    expect(emitted.some((e) => e.type === 'chat.updated')).toBe(true);
    expect(db.chats.update).toHaveBeenCalledWith(chatId, expect.objectContaining({ processState: null }));
  });
});
