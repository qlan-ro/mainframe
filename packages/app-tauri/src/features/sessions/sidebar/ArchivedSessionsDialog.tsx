/**
 * ArchivedSessionsDialog — list archived sessions and restore them.
 *
 * Source of truth: the live thread list from useAssistantRuntime().threads,
 * mapped via threadListStateToSessionItems → filterArchivedSessions (pure).
 * No extra API fetch needed for the list; Restore calls unarchiveChat then
 * triggers runtime.threads.reload() to sync the native thread list.
 */
import { useCallback, useMemo, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { Clock, Loader2 } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { unarchiveChat } from '@/lib/api/chats';
import { threadListStateToSessionItems } from '../view-model/chat-to-thread-custom';
import { filterArchivedSessions } from '../view-model/archived-sessions';
import { formatRelativeTime } from '../view-model/relative-time';

// ── single archived-session row ───────────────────────────────────────────────

interface ArchivedRowProps {
  id: string;
  title: string;
  projectName: string | null;
  updatedAt: number;
  restoring: string | null;
  onRestore: (id: string) => void;
}

function ArchivedSessionRow({ id, title, projectName, updatedAt, restoring, onRestore }: ArchivedRowProps) {
  const isThis = restoring === id;
  const isAny = restoring !== null;
  const when = formatRelativeTime(updatedAt, Date.now());

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid="archived-session-item"
          className="flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-body text-foreground">{title}</div>
            <div className="mt-0.5 flex items-center gap-1 text-caption text-mf-text-3">
              {projectName !== null && (
                <>
                  <span className="max-w-[140px] truncate">{projectName}</span>
                  <span>·</span>
                </>
              )}
              <Clock className="size-2.5 shrink-0" />
              <span>{when}</span>
            </div>
          </div>
          <button
            type="button"
            data-testid="restore-session-btn"
            disabled={isAny}
            onClick={() => onRestore(id)}
            onPointerEnter={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-caption text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
          >
            {isThis ? (
              <>
                <Loader2 className="size-2.5 animate-spin" />
                Restoring…
              </>
            ) : (
              'Restore'
            )}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[280px] whitespace-pre-wrap break-words">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

// ── dialog root ───────────────────────────────────────────────────────────────

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
  const runtime = useAssistantRuntime();
  const [restoring, setRestoring] = useState<string | null>(null);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const archivedItems = useMemo(() => {
    if (!open) return [];
    const allItems = runtime.threads ? threadListStateToSessionItems(runtime.threads.getState()) : [];
    return filterArchivedSessions(allItems, filterProjectId);
  }, [open, runtime, filterProjectId]);

  const handleRestore = useCallback(
    async (chatId: string) => {
      if (restoring) return;
      setRestoring(chatId);
      try {
        await unarchiveChat(port, chatId);
        runtime.threads.reload();
      } catch (e: unknown) {
        console.warn('[ArchivedSessionsDialog] unarchive failed', e);
      } finally {
        setRestoring(null);
      }
    },
    [port, restoring, runtime],
  );

  const showProjectName = filterProjectId === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sessions-archived-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Archived sessions</DialogTitle>
        </DialogHeader>

        {archivedItems.length === 0 ? (
          <div className="py-8 text-center text-body text-muted-foreground">No archived sessions</div>
        ) : (
          <ScrollArea className="max-h-[340px]">
            <div className="flex flex-col gap-0.5 pr-2">
              {archivedItems.map((item) => (
                <ArchivedSessionRow
                  key={item.id}
                  id={item.id}
                  title={item.title ?? 'Untitled session'}
                  projectName={showProjectName ? (projectMap.get(item.custom.projectId) ?? 'Unknown project') : null}
                  updatedAt={item.custom.updatedAt}
                  restoring={restoring}
                  onRestore={(id) => void handleRestore(id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
