/**
 * Archived sessions, and the way back out of the archive.
 *
 * The list is derived from the live thread list rather than fetched: archiving
 * never removes a chat, it only flags one, so every row this dialog can show is
 * already loaded.
 *
 * A restored row leaves immediately instead of waiting for the reload — the
 * reload is a round trip, and a row that lingers reads as a failed restore.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { ClockIcon, Loader2Icon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { unarchiveChat } from '@/lib/api/chats';
import { DialogRowList } from './DialogRowList';
import { archivedThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { filterArchivedSessions } from '@/features/sessions/view-model/archived-sessions';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';

interface ArchivedRowProps {
  id: string;
  title: string;
  /** Null under a project filter, where every row shares one project. */
  projectName: string | null;
  updatedAt: number;
  /** The id currently restoring, if any — locks every row's action. */
  restoring: string | null;
  onRestore: (id: string) => void;
}

function ArchivedSessionRow({ id, title, projectName, updatedAt, restoring, onRestore }: ArchivedRowProps) {
  return (
    <div data-testid="archived-session-item" className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
      <div className="min-w-0 flex-1">
        <TruncatedWithTooltip text={title} side="left" className="block font-medium" />
        {projectName !== null && (
          <TruncatedWithTooltip text={projectName} side="left" className="mt-0.5 block text-xs text-muted-foreground" />
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          data-testid="restore-session-btn"
          variant="ghost"
          size="xs"
          disabled={restoring !== null}
          onClick={() => onRestore(id)}
        >
          {restoring === id ? (
            <>
              <Loader2Icon className="animate-spin" />
              Restoring…
            </>
          ) : (
            'Restore'
          )}
        </Button>
        <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <ClockIcon className="size-3 shrink-0" />
          {formatRelativeTime(updatedAt, Date.now())}
        </span>
      </div>
    </div>
  );
}

interface ArchivedSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  port: number;
  projects: Project[];
  filterProjectId: string | null;
}

export function ArchivedSessionsDialog({
  open,
  onOpenChange,
  port,
  projects,
  filterProjectId,
}: ArchivedSessionsDialogProps) {
  const aui = useAui();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoredIds, setRestoredIds] = useState(new Set<string>());

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  useEffect(() => {
    if (open) setRestoredIds(new Set());
  }, [open]);

  const items = useMemo(() => {
    if (!open) return [];
    const all = archivedThreadItemsToSessionItems(aui.threads.getState().threadItems);
    return filterArchivedSessions(all, filterProjectId).filter((item) => !restoredIds.has(item.id));
  }, [open, aui, filterProjectId, restoredIds]);

  const handleRestore = useCallback(
    async (chatId: string) => {
      if (restoring !== null) return;
      setRestoring(chatId);
      try {
        await unarchiveChat(port, chatId);
        aui.threads.reload();
        setRestoredIds((prev) => new Set(prev).add(chatId));
      } catch (e: unknown) {
        console.warn('[v2/ArchivedSessionsDialog] unarchive failed', e);
      } finally {
        setRestoring(null);
      }
    },
    [port, restoring, aui],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sessions-archived-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Archived sessions</DialogTitle>
          <DialogDescription>Restoring returns a session to the sidebar.</DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No archived sessions</p>
        ) : (
          <DialogRowList
            items={items}
            itemKey={(item) => item.id}
            renderItem={(item) => (
              <ArchivedSessionRow
                id={item.id}
                title={item.title ?? 'Untitled session'}
                projectName={
                  filterProjectId === null ? (projectNames.get(item.custom.projectId) ?? 'Unknown project') : null
                }
                updatedAt={item.custom.updatedAt}
                restoring={restoring}
                onRestore={(id) => void handleRestore(id)}
              />
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
