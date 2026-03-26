import type { Chat, DaemonEvent, ExternalSession } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { createChildLogger } from '../logger.js';
import { deriveTitleFromMessage, generateTitle } from './title-generator.js';

const logger = createChildLogger('chat:external-sessions');

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class ExternalSessionService {
  private scanIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private lastCounts = new Map<string, number>();

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private emitEvent: (event: DaemonEvent) => void,
  ) {}

  /** Scan for importable external sessions for a project */
  async scan(projectId: string): Promise<ExternalSession[]> {
    const project = this.db.projects.get(projectId);
    if (!project) return [];

    const allAdapters = this.adapters.getAll();
    const allSessions: ExternalSession[] = [];

    for (const adapter of allAdapters) {
      if (!adapter.listExternalSessions) continue;

      const excludeIds = this.db.chats.getImportedSessionIds(projectId);
      try {
        const sessions = await adapter.listExternalSessions(project.path, excludeIds);
        for (const session of sessions) {
          session.adapterId = adapter.id;
        }
        allSessions.push(...sessions);
      } catch (err) {
        logger.warn({ err, adapterId: adapter.id, projectId }, 'Failed to scan external sessions');
      }
    }

    return allSessions;
  }

  /** Import an external session, creating a Mainframe chat for it */
  async importSession(
    projectId: string,
    sessionId: string,
    adapterId: string,
    title?: string,
    createdAt?: string,
    modifiedAt?: string,
  ): Promise<Chat> {
    const existing = this.db.chats.findByExternalSessionId(sessionId, projectId);
    if (existing) return existing;

    const chat = this.db.chats.create(projectId, adapterId);
    const updates: Partial<Chat> = { claudeSessionId: sessionId };

    // Strip XML-like tags from the title (e.g. <command-message>, <local-command-caveat>)
    const cleanTitle = title ? stripXmlTags(title) : undefined;
    if (cleanTitle) updates.title = deriveTitleFromMessage(cleanTitle);

    if (createdAt) updates.createdAt = createdAt;
    if (modifiedAt) updates.updatedAt = modifiedAt;
    this.db.chats.update(chat.id, updates);
    Object.assign(chat, updates);

    logger.info({ chatId: chat.id, sessionId, projectId }, 'external session imported');
    this.emitEvent({ type: 'chat.created', chat, source: 'import' });

    // Fire-and-forget LLM title generation to replace the truncated title
    if (cleanTitle) {
      this.generateImportTitle(chat, cleanTitle, adapterId).catch((err) =>
        logger.warn({ err, chatId: chat.id }, 'Import title generation failed'),
      );
    }

    return chat;
  }

  private async generateImportTitle(chat: Chat, content: string, adapterId: string): Promise<void> {
    const disabled = this.db.settings.get('general', 'titleGeneration.disabled');
    if (disabled === 'true') return;

    const binary = this.db.settings.get('provider', `${adapterId}.titleBinary`) || 'claude';
    const title = await generateTitle(content, binary);
    if (!title) return;

    chat.title = title;
    this.db.chats.update(chat.id, { title });
    this.emitEvent({ type: 'chat.updated', chat });
  }

  /** Start auto-scanning for a project (on project open) */
  startAutoScan(projectId: string): void {
    this.stopAutoScan(projectId);

    this.emitCount(projectId).catch((err) => logger.warn({ err, projectId }, 'Initial external session scan failed'));

    const interval = setInterval(() => {
      this.emitCount(projectId).catch((err) =>
        logger.warn({ err, projectId }, 'Periodic external session scan failed'),
      );
    }, SCAN_INTERVAL_MS);

    this.scanIntervals.set(projectId, interval);
  }

  /** Stop auto-scanning for a project */
  stopAutoScan(projectId: string): void {
    const interval = this.scanIntervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      this.scanIntervals.delete(projectId);
      this.lastCounts.delete(projectId);
    }
  }

  /** Stop all auto-scans (for shutdown) */
  stopAll(): void {
    for (const [projectId] of this.scanIntervals) {
      this.stopAutoScan(projectId);
    }
  }

  private async emitCount(projectId: string): Promise<void> {
    const sessions = await this.scan(projectId);
    const count = sessions.length;
    const lastCount = this.lastCounts.get(projectId);

    if (lastCount !== count) {
      this.lastCounts.set(projectId, count);
      this.emitEvent({
        type: 'sessions.external.count',
        projectId,
        count,
      } as DaemonEvent);
    }
  }
}

/** Remove XML-like tags and collapse whitespace, returning empty string if nothing remains. */
function stripXmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
