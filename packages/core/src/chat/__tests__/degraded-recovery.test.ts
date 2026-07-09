import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { ChatsRepository } from '../../db/chats.js';
import { ProjectsRepository } from '../../db/projects.js';
import { initializeSchema } from '../../db/schema.js';
import {
  continueHere,
  continueInProjectRoot,
  recreateChatWorktree,
  type DegradedRecoveryDeps,
} from '../degraded-recovery.js';

describe('degraded-recovery', () => {
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let projectId: string;
  let chatId: string;
  let synced: Array<{ chatId: string; partial: Partial<Chat> }>;
  let updatedIds: string[];
  let clearedMessageIds: string[];
  let killedSessions: number;
  let activeSession: { isSpawned: boolean; kill: () => Promise<void> } | null;
  let branchExists: ReturnType<typeof vi.fn<(projectPath: string, branchName: string) => Promise<boolean>>>;
  let addWorktree: ReturnType<
    typeof vi.fn<(projectPath: string, worktreePath: string, branchName: string) => Promise<void>>
  >;

  function makeDeps(): DegradedRecoveryDeps {
    return {
      db: { chats, projects } as unknown as DegradedRecoveryDeps['db'],
      getActiveChat: (id) =>
        id === chatId && activeSession ? ({ chat: chats.get(chatId)!, session: activeSession } as never) : undefined,
      syncChatFields: (id, partial) => synced.push({ chatId: id, partial }),
      emitChatUpdated: (id) => updatedIds.push(id),
      clearMessages: (id) => clearedMessageIds.push(id),
      git: { branchExists, addWorktree },
    };
  }

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initializeSchema(sqlite);
    chats = new ChatsRepository(sqlite);
    projects = new ProjectsRepository(sqlite);
    projectId = projects.create('/project/rec').id;
    chatId = chats.create(projectId, 'claude').id;
    synced = [];
    updatedIds = [];
    clearedMessageIds = [];
    killedSessions = 0;
    activeSession = null;
    branchExists = vi.fn(async () => true);
    addWorktree = vi.fn(async () => undefined);
  });

  describe('continueHere', () => {
    it('clears the dead session identity, drops cached messages, and broadcasts', async () => {
      chats.update(chatId, {
        claudeSessionId: 'dead-sess',
        sessionFilePath: '/x/dead-sess.jsonl',
        transcriptMissing: true,
      });

      await continueHere(makeDeps(), chatId);

      const row = chats.get(chatId);
      expect(row?.claudeSessionId).toBeNull();
      expect(row?.sessionFilePath).toBeNull();
      expect(row?.transcriptMissing).toBe(false);
      expect(clearedMessageIds).toEqual([chatId]);
      expect(updatedIds).toEqual([chatId]);
      expect(synced).toEqual([
        { chatId, partial: { claudeSessionId: undefined, sessionFilePath: undefined, transcriptMissing: false } },
      ]);
    });

    it('kills a spawned session so the next send starts fresh', async () => {
      chats.update(chatId, { claudeSessionId: 'dead-sess', transcriptMissing: true });
      activeSession = {
        isSpawned: true,
        kill: async () => {
          killedSessions += 1;
        },
      };

      await continueHere(makeDeps(), chatId);
      expect(killedSessions).toBe(1);
    });

    it('rejects for an unknown chat', async () => {
      await expect(continueHere(makeDeps(), 'nope')).rejects.toThrow(/not found/i);
    });
  });

  describe('continueInProjectRoot', () => {
    it('detaches the chat from its deleted worktree and broadcasts', async () => {
      chats.update(chatId, { worktreePath: '/project/rec/.worktrees/feat-x', branchName: 'feat-x' });

      await continueInProjectRoot(makeDeps(), chatId);

      const row = chats.get(chatId);
      expect(row?.worktreePath).toBeUndefined();
      expect(row?.branchName).toBeUndefined();
      expect(updatedIds).toEqual([chatId]);
      expect(synced).toEqual([{ chatId, partial: { worktreePath: undefined, branchName: undefined } }]);
    });

    it('rejects when the chat has no worktree', async () => {
      await expect(continueInProjectRoot(makeDeps(), chatId)).rejects.toThrow(/no worktree/i);
    });
  });

  describe('recreateChatWorktree', () => {
    it('recreates the worktree at the stored path from the stored branch and broadcasts', async () => {
      chats.update(chatId, { worktreePath: '/project/rec/.worktrees/feat-x', branchName: 'feat-x' });

      await recreateChatWorktree(makeDeps(), chatId);

      expect(addWorktree).toHaveBeenCalledWith('/project/rec', '/project/rec/.worktrees/feat-x', 'feat-x');
      expect(updatedIds).toEqual([chatId]);
    });

    it('fails with a 409 and a clear message when the branch no longer exists', async () => {
      chats.update(chatId, { worktreePath: '/project/rec/.worktrees/feat-x', branchName: 'feat-x' });
      branchExists.mockResolvedValue(false);

      await expect(recreateChatWorktree(makeDeps(), chatId)).rejects.toMatchObject({
        message: expect.stringMatching(/branch "feat-x" no longer exists/i),
        statusCode: 409,
      });
      expect(addWorktree).not.toHaveBeenCalled();
    });

    it('rejects when the chat has no stored worktree/branch', async () => {
      await expect(recreateChatWorktree(makeDeps(), chatId)).rejects.toThrow(/no worktree/i);
    });
  });
});
