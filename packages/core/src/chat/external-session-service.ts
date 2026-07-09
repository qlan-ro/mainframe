import type { Chat, DaemonEvent, ExternalSession, ExternalSessionPage } from '@qlan-ro/mainframe-types';
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
    /** ChatManager.reconcileTranscript — flags chats whose transcript vanished (degraded-chat sweep). */
    private reconcileTranscript?: (chat: Chat) => Promise<boolean>,
  ) {}

  /**
   * Reconcile transcript presence for every non-archived chat of the project
   * that has a CLI session id, so the sidebar degraded marker appears without
   * the chat being opened. Runs on the same cadence as the auto-scan.
   */
  async sweepTranscriptPresence(projectId: string): Promise<void> {
    if (!this.reconcileTranscript) return;
    const candidates = this.db.chats.list(projectId).filter((c) => c.status !== 'archived' && c.claudeSessionId);
    for (const chat of candidates) {
      try {
        await this.reconcileTranscript(chat);
      } catch (err) {
        logger.warn({ err, chatId: chat.id }, 'transcript presence sweep failed');
      }
    }
  }

  /** Page of importable external sessions merged and sorted across all adapters for a project. */
  async scanPage(projectId: string, offset: number, limit: number): Promise<ExternalSessionPage> {
    const project = this.db.projects.get(projectId);
    if (!project) return { sessions: [], total: 0, nextOffset: null };

    const adapters = this.adapters.getAll().filter((a) => a.listExternalSessions);
    const excludeIds = this.db.chats.getImportedSessionIds(projectId);

    // Count-only: each adapter returns its total without enriching.
    if (limit <= 0) {
      let total = 0;
      for (const adapter of adapters) {
        try {
          const page = await adapter.listExternalSessions!(project.path, excludeIds, { offset: 0, limit: 0 });
          total += page.total;
        } catch (err) {
          logger.warn({ err, adapterId: adapter.id, projectId }, 'Failed to count external sessions');
        }
      }
      return { sessions: [], total, nextOffset: null };
    }

    // Over-fetch each adapter's prefix [0, offset+limit), then merge-sort across
    // adapters by modifiedAt desc and slice the requested page. This is correct
    // for any number of session-listing adapters (claude + codex today).
    const prefixLimit = offset + limit;
    const collected: ExternalSession[] = [];
    let total = 0;
    for (const adapter of adapters) {
      try {
        const page = await adapter.listExternalSessions!(project.path, excludeIds, { offset: 0, limit: prefixLimit });
        for (const s of page.sessions) s.adapterId = adapter.id;
        collected.push(...page.sessions);
        total += page.total;
      } catch (err) {
        logger.warn({ err, adapterId: adapter.id, projectId }, 'Failed to scan external sessions');
      }
    }

    collected.sort((a, b) => {
      const d = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      return d !== 0 ? d : a.sessionId < b.sessionId ? 1 : -1;
    });
    const sessions = collected.slice(offset, offset + limit);
    const nextOffset = offset + limit < total ? offset + limit : null;
    return { sessions, total, nextOffset };
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
    void this.sweepTranscriptPresence(projectId);

    const interval = setInterval(() => {
      this.emitCount(projectId).catch((err) =>
        logger.warn({ err, projectId }, 'Periodic external session scan failed'),
      );
      void this.sweepTranscriptPresence(projectId);
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
    const { total } = await this.scanPage(projectId, 0, 0); // count-only (no enrichment)
    const lastCount = this.lastCounts.get(projectId);
    if (lastCount !== total) {
      this.lastCounts.set(projectId, total);
      this.emitEvent({
        type: 'sessions.external.count',
        projectId,
        count: total,
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
