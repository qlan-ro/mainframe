import { nanoid } from 'nanoid';
import { relative, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  SessionMention,
  SessionContext,
  ChatMessage,
  AdapterSession,
  ContextFile,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';

export function extractMentionsFromText(chatId: string, text: string | undefined, db: DatabaseManager): boolean {
  if (!text) return false;
  const matches = text.matchAll(/(?:^|\s)@(\S+)/g);
  let changed = false;
  for (const m of matches) {
    const ref = m[1];
    if (!ref || (!ref.includes('/') && !ref.includes('.'))) continue;
    const cleaned = ref.replace(/<\/[^>]+>$/, '').replace(/[,;:!?)]+$/, '');
    const name = cleaned.split('/').pop() ?? cleaned;
    const mention: SessionMention = {
      id: nanoid(),
      kind: 'file',
      source: 'user',
      name,
      path: cleaned,
      timestamp: new Date().toISOString(),
    };
    if (db.chats.addMention(chatId, mention)) changed = true;
  }
  return changed;
}

export async function getSessionContext(
  chatId: string,
  projectPath: string,
  db: DatabaseManager,
  adapters: AdapterRegistry,
  session: AdapterSession | undefined,
  attachmentStore: AttachmentStore | undefined,
  adapterId: string | undefined,
): Promise<SessionContext> {
  let globalFiles: SessionContext['globalFiles'] = [];
  let projectFiles: SessionContext['projectFiles'] = [];
  if (session) {
    const files = session.getContextFiles();
    globalFiles = files.global;
    projectFiles = files.project;
  } else {
    const adapter = adapterId ? adapters.get(adapterId) : undefined;
    if (adapter?.getContextFiles) {
      const files = adapter.getContextFiles(projectPath);
      globalFiles = files.global;
      projectFiles = files.project;
    }
  }

  const toRelative = (p: string) => (isAbsolute(p) ? relative(projectPath, p) : p);

  const dedupedFiles = dedupeContextFiles(globalFiles, projectFiles, projectPath);

  const rawMentions = db.chats.getMentions(chatId);
  const mentions = rawMentions.map((m) => ({
    ...m,
    path: m.path ? toRelative(m.path) : m.path,
  }));
  const attachments = (await attachmentStore?.list(chatId)) ?? [];
  const modifiedFiles = db.chats.getPlanFiles(chatId).map(toRelative);
  const skillFiles = dedupeSkillFiles(db.chats.getSkillFiles(chatId));

  return {
    globalFiles: dedupedFiles.global,
    projectFiles: dedupedFiles.project,
    mentions,
    attachments,
    modifiedFiles,
    skillFiles,
  };
}

/**
 * Drop repeated skill entries. The same skill can be persisted under two paths
 * (a live probe hitting a real SKILL.md vs. a batch re-extraction falling back
 * to a conventional path), so path-only dedup lets duplicates through (#222).
 * Keyed on the display name, which the DB normalizes to the skill's leaf.
 */
export function dedupeSkillFiles(skills: SkillFileEntry[]): SkillFileEntry[] {
  const seen = new Set<string>();
  const out: SkillFileEntry[] = [];
  for (const skill of skills) {
    const key = skill.displayName || skill.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

/**
 * Remove exact path repeats within each list and any project file that resolves
 * to the same physical file as a global one (e.g. a session opened at the home
 * dir, where .claude/CLAUDE.md IS the global CLAUDE.md) so it isn't listed twice
 * (#222). Global entries are kept as canonical.
 */
export function dedupeContextFiles(
  global: ContextFile[],
  project: ContextFile[],
  projectPath: string,
  homeDir: string = homedir(),
): { global: ContextFile[]; project: ContextFile[] } {
  const dedupedGlobal = dedupeByPath(global);
  const globalAbs = new Set(dedupedGlobal.map((f) => toAbsoluteContextPath(f.path, projectPath, homeDir)));
  const dedupedProject = dedupeByPath(project).filter(
    (f) => !globalAbs.has(toAbsoluteContextPath(f.path, projectPath, homeDir)),
  );
  return { global: dedupedGlobal, project: dedupedProject };
}

function dedupeByPath(files: ContextFile[]): ContextFile[] {
  const seen = new Set<string>();
  return files.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

function toAbsoluteContextPath(p: string, projectPath: string, homeDir: string): string {
  if (p === '~') return homeDir;
  if (p.startsWith('~/')) return join(homeDir, p.slice(2));
  if (isAbsolute(p)) return p;
  return join(projectPath, p);
}

export function extractLatestPlanFileFromMessages(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]!;
      const text = block.type === 'tool_result' ? block.content : block.type === 'text' ? block.text : null;
      if (!text) continue;
      const planPath = extractPlanFilePathFromText(text);
      if (planPath) return planPath;
    }
  }
  return null;
}

export function extractPlanFilePathFromText(text: string): string | null {
  const savedMatch = text.match(/Your plan has been saved to:\s*(\/\S+\.md)/);
  if (savedMatch?.[1]) return savedMatch[1].trim();

  const genericMatch = text.match(/(?:^|\s|`)(\/[^\s`]+\.md)(?=$|\s|`)/);
  return genericMatch?.[1]?.trim() ?? null;
}
