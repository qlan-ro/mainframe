import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Globe, FolderOpen, MessageSquare } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useChatsStore } from '../../store';
import { daemonClient } from '../../lib/client';
import { getSessionContext } from '../../lib/api';
import type { SessionContext } from '@mainframe/types';
import { ContextSection } from './ContextSection';
import { ContextFileItem } from './ContextFileItem';
import { SessionAttachmentsGrid } from './SessionAttachmentsGrid';

export function ContextTab(): React.ReactElement {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [context, setContext] = useState<SessionContext | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContext = useCallback(() => {
    if (!activeChatId) return;
    getSessionContext(activeChatId)
      .then(setContext)
      .catch((err) => log.warn('fetch context failed', { err: String(err) }));
  }, [activeChatId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  useEffect(() => {
    const unsub = daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(fetchContext, 500);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeChatId, fetchContext]);

  if (!activeChatId) {
    return <div className="text-mf-small text-mf-text-secondary text-center py-4">No active chat</div>;
  }

  if (!context) {
    return <div className="text-mf-small text-mf-text-secondary text-center py-4">Loading context...</div>;
  }

  const { globalFiles, projectFiles, mentions, attachments, modifiedFiles, skillFiles = [] } = context;

  // Deduplicate: collect all file paths from mentions + modified + skills into one list
  const sessionFiles = new Map<string, { badge?: string; displayName?: string }>();
  for (const m of mentions) {
    if (m.kind === 'file' && m.path && m.source !== 'attachment') {
      sessionFiles.set(m.path, {
        badge: m.source === 'user' ? '@' : 'auto',
      });
    }
  }
  for (const f of modifiedFiles) {
    const existing = sessionFiles.get(f);
    sessionFiles.set(f, { badge: existing?.badge ?? 'plan' });
  }
  for (const f of skillFiles) {
    if (!sessionFiles.has(f.path)) {
      sessionFiles.set(f.path, { badge: 'skill', displayName: f.displayName });
    }
  }

  const sessionCount = sessionFiles.size + attachments.length;

  return (
    <div className="space-y-2">
      <ContextSection icon={Globe} title="Global" count={globalFiles.length} defaultOpen>
        {globalFiles.map((f) => (
          <ContextFileItem key={f.path} path={f.path} content={f.content} />
        ))}
      </ContextSection>

      <ContextSection icon={FolderOpen} title="Project" count={projectFiles.length} defaultOpen>
        {projectFiles.map((f) => (
          <ContextFileItem key={f.path} path={f.path} content={f.content} />
        ))}
      </ContextSection>

      <ContextSection icon={MessageSquare} title="Session" count={sessionCount}>
        {Array.from(sessionFiles.entries()).map(([filePath, { badge, displayName }]) => (
          <ContextFileItem
            key={filePath}
            path={filePath}
            displayName={displayName}
            chatId={activeChatId ?? undefined}
            badge={badge}
          />
        ))}

        {attachments.length > 0 && (
          <div className="mt-1 px-2">
            <div className="text-mf-status text-mf-text-secondary uppercase tracking-wider mb-1">Attachments</div>
            <SessionAttachmentsGrid chatId={activeChatId} attachments={attachments} />
          </div>
        )}
      </ContextSection>
    </div>
  );
}
