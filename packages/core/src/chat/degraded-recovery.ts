/**
 * Degraded-chat recovery actions (missing transcript / missing worktree).
 *
 * Backs the daemon recovery routes and the degraded-chat UI card:
 * - `continueHere` — forget the dead CLI session so the next send spawns fresh
 *   in the same chat row (title/branch/worktree/project metadata carry over).
 * - `continueInProjectRoot` — detach a chat from its deleted worktree and
 *   rebind it to the main checkout.
 * - `recreateChatWorktree` — re-add the worktree at its stored path from the
 *   stored branch; fails clearly (409) when the branch is gone.
 */
import type { Chat } from '@qlan-ro/mainframe-types';
import type { ChatsRepository } from '../db/chats.js';
import type { ProjectsRepository } from '../db/projects.js';
import type { ActiveChat } from './types.js';
import { branchExists, addWorktreeForBranch } from '../workspace/worktree.js';

export interface DegradedRecoveryGit {
  branchExists(projectPath: string, branchName: string): Promise<boolean>;
  addWorktree(projectPath: string, worktreePath: string, branchName: string): Promise<void>;
}

export interface DegradedRecoveryDeps {
  db: { chats: ChatsRepository; projects: ProjectsRepository };
  getActiveChat(chatId: string): ActiveChat | undefined;
  syncChatFields(chatId: string, partial: Partial<Chat>): void;
  emitChatUpdated(chatId: string): void;
  /** Drop the in-memory message + display caches (the history is gone for good). */
  clearMessages(chatId: string): void;
  /** Injectable for tests; defaults to the real git worktree ops. */
  git?: DegradedRecoveryGit;
}

const defaultGit: DegradedRecoveryGit = { branchExists, addWorktree: addWorktreeForBranch };

function requireChat(deps: DegradedRecoveryDeps, chatId: string): Chat {
  const chat = deps.db.chats.get(chatId);
  if (!chat) throw new Error(`Chat ${chatId} not found`);
  return chat;
}

/** Kill a spawned CLI session so the next send respawns with the recovered config. */
async function killSpawnedSession(deps: DegradedRecoveryDeps, chatId: string): Promise<void> {
  const active = deps.getActiveChat(chatId);
  if (active?.session?.isSpawned) {
    await active.session.kill();
    active.session = null;
  }
}

export async function continueHere(deps: DegradedRecoveryDeps, chatId: string): Promise<void> {
  requireChat(deps, chatId);
  await killSpawnedSession(deps, chatId);
  deps.db.chats.clearSession(chatId);
  deps.syncChatFields(chatId, { claudeSessionId: undefined, sessionFilePath: undefined, transcriptMissing: false });
  deps.clearMessages(chatId);
  deps.emitChatUpdated(chatId);
}

export async function continueInProjectRoot(deps: DegradedRecoveryDeps, chatId: string): Promise<void> {
  const chat = requireChat(deps, chatId);
  if (!chat.worktreePath) throw new Error('Chat has no worktree');
  await killSpawnedSession(deps, chatId);
  deps.db.chats.clearWorktree(chatId);
  deps.syncChatFields(chatId, { worktreePath: undefined, branchName: undefined });
  deps.emitChatUpdated(chatId);
}

export async function recreateChatWorktree(deps: DegradedRecoveryDeps, chatId: string): Promise<void> {
  const chat = requireChat(deps, chatId);
  if (!chat.worktreePath || !chat.branchName) throw new Error('Chat has no worktree to recreate');
  const project = deps.db.projects.get(chat.projectId);
  if (!project) throw new Error(`Project ${chat.projectId} not found`);

  const git = deps.git ?? defaultGit;
  if (!(await git.branchExists(project.path, chat.branchName))) {
    throw Object.assign(
      new Error(`Branch "${chat.branchName}" no longer exists — continue in the project root instead`),
      { statusCode: 409 },
    );
  }
  await git.addWorktree(project.path, chat.worktreePath, chat.branchName);
  // enrichChat recomputes worktreeMissing from disk on read, so a plain re-emit clears the flag.
  deps.emitChatUpdated(chatId);
}
