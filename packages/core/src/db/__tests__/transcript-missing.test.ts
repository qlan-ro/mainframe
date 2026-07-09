import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatsRepository } from '../chats.js';
import { ProjectsRepository } from '../projects.js';
import { initializeSchema } from '../schema.js';

describe('chats.transcript_missing column', () => {
  let db: Database.Database;
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let projectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    chats = new ChatsRepository(db);
    projects = new ProjectsRepository(db);
    projectId = projects.create('/project/transcripts').id;
  });

  it('migration adds the column to a pre-existing chats table', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, last_opened_at TEXT NOT NULL);
      CREATE TABLE chats (id TEXT PRIMARY KEY, adapter_id TEXT NOT NULL, project_id TEXT NOT NULL,
        title TEXT, claude_session_id TEXT, model TEXT, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, total_cost REAL DEFAULT 0,
        total_tokens_input INTEGER DEFAULT 0, total_tokens_output INTEGER DEFAULT 0);
    `);
    initializeSchema(legacy);
    const cols = legacy.pragma('table_info(chats)') as { name: string }[];
    expect(cols.some((c) => c.name === 'transcript_missing')).toBe(true);
    legacy.close();
  });

  it('defaults to false on new chats', () => {
    const chat = chats.create(projectId, 'claude');
    expect(chats.get(chat.id)?.transcriptMissing).toBe(false);
  });

  it('persists transcriptMissing through update() and maps it back as a boolean', () => {
    const chat = chats.create(projectId, 'claude');
    chats.update(chat.id, { transcriptMissing: true });
    expect(chats.get(chat.id)?.transcriptMissing).toBe(true);
    chats.update(chat.id, { transcriptMissing: false });
    expect(chats.get(chat.id)?.transcriptMissing).toBe(false);
  });

  it('includes transcriptMissing in list() results', () => {
    const chat = chats.create(projectId, 'claude');
    chats.update(chat.id, { transcriptMissing: true });
    const listed = chats.list(projectId).find((c) => c.id === chat.id);
    expect(listed?.transcriptMissing).toBe(true);
  });

  describe('clearSession', () => {
    it('clears session identity and resets the transcript flag', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, {
        claudeSessionId: 'dead-session',
        sessionFilePath: '/home/u/.claude/projects/x/dead-session.jsonl',
        transcriptMissing: true,
      });
      chats.clearSession(chat.id);
      const loaded = chats.get(chat.id);
      expect(loaded?.claudeSessionId).toBeNull();
      expect(loaded?.sessionFilePath).toBeNull();
      expect(loaded?.transcriptMissing).toBe(false);
    });
  });

  describe('clearWorktree', () => {
    it('clears worktree binding so the chat rebinds to the project root', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { worktreePath: '/project/.worktrees/feat-x', branchName: 'feat-x' });
      chats.clearWorktree(chat.id);
      const loaded = chats.get(chat.id);
      expect(loaded?.worktreePath).toBeUndefined();
      expect(loaded?.branchName).toBeUndefined();
    });
  });
});
