import { nanoid } from 'nanoid';
import { relative, isAbsolute } from 'node:path';
import type { MessageContent, SessionMention, SessionContext, ChatMessage, AdapterSession } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';

export function extractMentionsFromText(chatId: string, text: string, db: DatabaseManager): boolean {
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

export function trackFileActivity(
  chatId: string,
  content: MessageContent[],
  db: DatabaseManager,
  projectPath: string | undefined,
): boolean {
  let changed = false;
  let resolvedProjectPath = projectPath;
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    let filePath = (block.input as Record<string, unknown>).file_path as string;

    if (filePath && ['Write', 'Edit'].includes(block.name)) {
      if (isAbsolute(filePath)) {
        if (!resolvedProjectPath) {
          const chat = db.chats.get(chatId);
          const project = chat ? db.projects.get(chat.projectId) : null;
          resolvedProjectPath = chat?.worktreePath ?? project?.path;
        }
        if (resolvedProjectPath) filePath = relative(resolvedProjectPath, filePath);
      }
      if (filePath.startsWith('..')) continue;
      if (db.chats.addModifiedFile(chatId, filePath)) {
        changed = true;
      }
    }
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

  const rawMentions = db.chats.getMentions(chatId);
  const mentions = rawMentions.map((m) => ({
    ...m,
    path: m.path ? toRelative(m.path) : m.path,
  }));
  const attachments = (await attachmentStore?.list(chatId)) ?? [];
  const modifiedFiles = db.chats.getPlanFiles(chatId).map(toRelative);
  const skillFiles = db.chats.getSkillFiles(chatId);

  return { globalFiles, projectFiles, mentions, attachments, modifiedFiles, skillFiles };
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
