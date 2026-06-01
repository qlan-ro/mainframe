import type Database from 'better-sqlite3';
import type { Chat, DetectedPr, SessionMention, SkillFileEntry, TodoItem } from '@qlan-ro/mainframe-types';
import { nanoid } from 'nanoid';
import type { ChatTagsRepository } from './chat-tags.js';

/** Raw shape returned by SQLite before boolean/JSON coercion. */
type RawChatRow = Omit<
  Chat,
  'pinned' | 'planMode' | 'mentions' | 'modifiedFiles' | 'todos' | 'effort' | 'detectedPrs'
> & {
  mentions: string;
  modifiedFiles: string;
  todos: string;
  pinned: number;
  planMode: number;
  effort: string | null;
  detectedPrs: string;
};

const CHAT_SELECT_FIELDS = `
  id, adapter_id as adapterId, project_id as projectId,
  title, claude_session_id as claudeSessionId, model,
  permission_mode as permissionMode, status,
  created_at as createdAt, updated_at as updatedAt,
  total_cost as totalCost, total_tokens_input as totalTokensInput,
  total_tokens_output as totalTokensOutput, last_context_tokens_input as lastContextTokensInput,
  mentions, modified_files as modifiedFiles,
  worktree_path as worktreePath, branch_name as branchName,
  process_state as processState, todos, pinned, effort,
  plan_mode as planMode, detected_prs as detectedPrs,
  session_file_path as sessionFilePath
`.trim();

export interface ChatListFilters {
  projectId?: string;
  tagsAll?: string[];
  hasWorktree?: boolean;
  includeArchived?: boolean;
}

function parseEffort(value: string | null | undefined): Chat['effort'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    /* expected: malformed stored JSON column, fall back */
    return fallback;
  }
}

export class ChatsRepository {
  constructor(
    private db: Database.Database,
    private chatTags?: ChatTagsRepository,
  ) {}

  list(projectId: string): Chat[] {
    const rows = this.db
      .prepare(`SELECT ${CHAT_SELECT_FIELDS} FROM chats WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC`)
      .all(projectId) as RawChatRow[];
    const chats = this.mapRows(rows);
    this.populateBulkTags(chats);
    return chats;
  }

  listAll(): Chat[] {
    const rows = this.db
      .prepare(`SELECT ${CHAT_SELECT_FIELDS} FROM chats ORDER BY pinned DESC, updated_at DESC, rowid DESC`)
      .all() as RawChatRow[];
    const chats = this.mapRows(rows);
    this.populateBulkTags(chats);
    return chats;
  }

  listFiltered(filters: ChatListFilters): Chat[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (!filters.includeArchived) {
      where.push("status != 'archived'");
    }
    if (filters.projectId) {
      where.push('project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.hasWorktree) {
      where.push('worktree_path IS NOT NULL');
    }
    if (filters.tagsAll && filters.tagsAll.length > 0) {
      if (!this.chatTags) {
        throw new Error('listFiltered with tagsAll requires ChatTagsRepository');
      }
      const ids = this.chatTags.filterChatIds(filters.tagsAll);
      if (!ids || ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      where.push(`id IN (${placeholders})`);
      params.push(...ids);
    }

    const sql = `SELECT ${CHAT_SELECT_FIELDS} FROM chats${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY pinned DESC, updated_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as RawChatRow[];
    const chats = this.mapRows(rows);
    this.populateBulkTags(chats);
    return chats;
  }

  get(id: string): Chat | null {
    const row = this.db.prepare(`SELECT ${CHAT_SELECT_FIELDS} FROM chats WHERE id = ?`).get(id) as RawChatRow | null;
    if (!row) return null;
    const chat = this.mapRow(row);
    this.populateTags(chat);
    return chat;
  }

  create(projectId: string, adapterId: string, model?: string, permissionMode?: string): Chat {
    const id = nanoid();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO chats (id, adapter_id, project_id, model, permission_mode, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `);
    stmt.run(id, adapterId, projectId, model || null, permissionMode || null, now, now);

    return {
      id,
      adapterId,
      projectId,
      model,
      permissionMode: (permissionMode as Chat['permissionMode']) || undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      lastContextTokensInput: 0,
      planMode: false,
    };
  }

  private static readonly updateColumnMap: Record<string, { column: string; transform?: (v: unknown) => unknown }> = {
    adapterId: { column: 'adapter_id' },
    model: { column: 'model' },
    claudeSessionId: { column: 'claude_session_id' },
    sessionFilePath: { column: 'session_file_path' },
    status: { column: 'status' },
    totalCost: { column: 'total_cost' },
    totalTokensInput: { column: 'total_tokens_input' },
    totalTokensOutput: { column: 'total_tokens_output' },
    lastContextTokensInput: { column: 'last_context_tokens_input' },
    title: { column: 'title' },
    permissionMode: { column: 'permission_mode' },
    worktreePath: { column: 'worktree_path', transform: (v) => v ?? null },
    branchName: { column: 'branch_name', transform: (v) => v ?? null },
    mentions: { column: 'mentions', transform: (v) => JSON.stringify(v) },
    processState: { column: 'process_state' },
    createdAt: { column: 'created_at' },
    updatedAt: { column: 'updated_at' },
    pinned: { column: 'pinned', transform: (v) => (v ? 1 : 0) },
    effort: { column: 'effort', transform: (v) => v ?? null },
    planMode: { column: 'plan_mode', transform: (v) => (v ? 1 : 0) },
  };

  update(id: string, updates: Partial<Chat>): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, { column, transform }] of Object.entries(ChatsRepository.updateColumnMap)) {
      const value = (updates as Record<string, unknown>)[key];
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        values.push(transform ? transform(value) : value);
      }
    }

    if (sets.length === 0) return;
    values.push(id);

    this.db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  getMentions(chatId: string): SessionMention[] {
    const stmt = this.db.prepare('SELECT mentions FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { mentions: string } | undefined;
    return parseJsonColumn(row?.mentions, []);
  }

  addMention(chatId: string, mention: SessionMention): boolean {
    const existing = this.getMentions(chatId);
    const isDuplicate = existing.some(
      (m) => m.kind === mention.kind && m.name === mention.name && m.path === mention.path,
    );
    if (isDuplicate) return false;
    existing.push(mention);
    this.db.prepare('UPDATE chats SET mentions = ? WHERE id = ?').run(JSON.stringify(existing), chatId);
    return true;
  }

  getPlanFiles(chatId: string): string[] {
    const stmt = this.db.prepare('SELECT plan_files FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { plan_files: string } | undefined;
    return parseJsonColumn(row?.plan_files, []);
  }

  addPlanFile(chatId: string, filePath: string): boolean {
    const existing = this.getPlanFiles(chatId);
    if (existing.includes(filePath)) return false;
    existing.push(filePath);
    this.db.prepare('UPDATE chats SET plan_files = ? WHERE id = ?').run(JSON.stringify(existing), chatId);
    return true;
  }

  getSkillFiles(chatId: string): SkillFileEntry[] {
    const stmt = this.db.prepare('SELECT skill_files FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { skill_files: string } | undefined;
    const raw: unknown[] = parseJsonColumn(row?.skill_files, []);
    return raw.map((entry) => {
      const skillPath = typeof entry === 'string' ? entry : (entry as SkillFileEntry).path;
      const segments = skillPath.split('/');
      const file = segments.pop() ?? skillPath;
      const name = file === 'SKILL.md' && segments.length > 0 ? segments.pop()! : file;
      return { path: skillPath, displayName: name };
    });
  }

  addSkillFile(chatId: string, entry: SkillFileEntry): boolean {
    const existing = this.getSkillFiles(chatId);
    if (existing.some((e) => e.path === entry.path)) return false;
    existing.push(entry);
    this.db.prepare('UPDATE chats SET skill_files = ? WHERE id = ?').run(JSON.stringify(existing), chatId);
    return true;
  }

  getDetectedPrs(chatId: string): DetectedPr[] {
    const stmt = this.db.prepare('SELECT detected_prs FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { detected_prs: string } | undefined;
    return parseJsonColumn(row?.detected_prs, []);
  }

  /**
   * Persist newly-detected PRs, deduplicating by URL. Returns the rows that
   * were actually written (i.e. either new, or had their `source` upgraded
   * from `mentioned` → `created`). Existing 'created' entries are never
   * downgraded to 'mentioned'.
   */
  addDetectedPrs(chatId: string, prs: DetectedPr[]): DetectedPr[] {
    const existing = this.getDetectedPrs(chatId);
    const byUrl = new Map(existing.map((p) => [p.url, p] as const));
    const written: DetectedPr[] = [];
    let mutated = false;

    for (const pr of prs) {
      const prev = byUrl.get(pr.url);
      if (!prev) {
        byUrl.set(pr.url, pr);
        written.push(pr);
        mutated = true;
      } else if (prev.source !== 'created' && pr.source === 'created') {
        byUrl.set(pr.url, { ...prev, source: 'created' });
        written.push({ ...prev, source: 'created' });
        mutated = true;
      }
    }

    if (mutated) {
      this.db
        .prepare('UPDATE chats SET detected_prs = ? WHERE id = ?')
        .run(JSON.stringify([...byUrl.values()]), chatId);
    }
    return written;
  }

  getTodos(chatId: string): TodoItem[] | null {
    const stmt = this.db.prepare('SELECT todos FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { todos: string | null } | undefined;
    if (!row?.todos) return null;
    return parseJsonColumn<TodoItem[]>(row.todos, []);
  }

  updateTodos(chatId: string, todos: TodoItem[]): void {
    this.db.prepare('UPDATE chats SET todos = ? WHERE id = ?').run(JSON.stringify(todos), chatId);
  }

  getImportedSessionIds(projectId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT claude_session_id FROM chats
      WHERE project_id = ? AND claude_session_id IS NOT NULL
    `);
    const rows = stmt.all(projectId) as { claude_session_id: string }[];
    return rows.map((r) => r.claude_session_id);
  }

  findByExternalSessionId(sessionId: string, projectId: string): Chat | null {
    const row = this.db
      .prepare(`SELECT ${CHAT_SELECT_FIELDS} FROM chats WHERE claude_session_id = ? AND project_id = ?`)
      .get(sessionId, projectId) as RawChatRow | null;
    if (!row) return null;
    const chat = this.mapRow(row);
    this.populateTags(chat);
    return chat;
  }

  private mapRow(row: RawChatRow): Chat {
    return {
      ...row,
      mentions: parseJsonColumn(row.mentions, []),
      modifiedFiles: parseJsonColumn(row.modifiedFiles, []),
      worktreePath: row.worktreePath || undefined,
      branchName: row.branchName || undefined,
      processState: (row.processState as Chat['processState']) || null,
      todos: parseJsonColumn(row.todos, undefined) ?? undefined,
      pinned: Boolean(row.pinned),
      effort: parseEffort(row.effort),
      planMode: Boolean(row.planMode),
      detectedPrs: parseJsonColumn<DetectedPr[]>(row.detectedPrs, []),
    };
  }

  private mapRows(rows: RawChatRow[]): Chat[] {
    return rows.map((row) => this.mapRow(row));
  }

  private populateBulkTags(chats: Chat[]): void {
    if (!this.chatTags || chats.length === 0) return;
    const tagsByChat = this.chatTags.bulkForChats(chats.map((c) => c.id));
    for (const c of chats) {
      c.tags = tagsByChat.get(c.id) ?? [];
    }
  }

  private populateTags(chat: Chat): void {
    if (!this.chatTags) return;
    chat.tags = this.chatTags.listForChat(chat.id);
  }
}
