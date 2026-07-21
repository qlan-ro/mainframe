import { useAssistantRuntime } from '@assistant-ui/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUnreadStore } from '@/store/unread-store';
import { threadListStateToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { countByBaseStatus, type BaseStatusCounts } from '@/features/sessions/view-model/count-by-base-status';
import { DaemonFooterStatus } from '@/features/daemon/DaemonFooterStatus';
import { QuotaCard } from '@/features/quota/QuotaCard';

const COUNT_META: { key: keyof BaseStatusCounts; label: string; dot: string; text: string }[] = [
  { key: 'working', label: 'Working', dot: 'bg-primary animate-pulse', text: 'text-primary' },
  { key: 'waiting', label: 'Waiting for you', dot: 'bg-mf-warning', text: 'text-mf-warning' },
  { key: 'idle', label: 'Idle', dot: 'bg-mf-text-4', text: 'text-muted-foreground' },
];

// Per-status session counts (Working/Waiting/Idle) are hidden for now per
// product request — kept computed and ready to re-enable via this flag rather
// than deleted (COUNT_META / countByBaseStatus stay intact).
const SHOW_SESSION_COUNTS = false;

export function SidebarFooterView({ counts }: { counts: BaseStatusCounts }) {
  return (
    <div
      data-testid="sidebar-footer"
      className="flex flex-shrink-0 flex-col gap-[6px] px-[12px] pb-[12px] pt-[10px] text-caption text-muted-foreground"
    >
      <QuotaCard />
      <DaemonFooterStatus />
      {SHOW_SESSION_COUNTS && (
        <span data-testid="sidebar-footer-counts" className="flex items-center justify-end gap-[9px]">
          {COUNT_META.filter((m) => counts[m.key] > 0).map((m) => (
            <Tooltip key={m.key}>
              <TooltipTrigger asChild>
                <span
                  data-testid={`sidebar-footer-count-${m.key}`}
                  className={`flex items-center gap-[4px] font-semibold tabular-nums ${m.text}`}
                >
                  <span className={`size-1.5 rounded-full ${m.dot}`} />
                  {counts[m.key]}
                </span>
              </TooltipTrigger>
              <TooltipContent>{m.label}</TooltipContent>
            </Tooltip>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Self-sufficient sidebar chrome footer: DaemonFooterStatus button + per-status
 * session counts. Derives its own counts from the thread list so it composes
 * directly under `SidebarShell` without threading props in.
 */
export function SidebarFooter() {
  const threads = useAssistantRuntime().threads;
  const unreadSet = useUnreadStore((s) => s.unread);
  // Recompute each render (getState() is a snapshot); the SidebarShell re-render
  // cascade keeps it as fresh as the old SessionSidebar-owned footer was.
  const items = threads ? threadListStateToSessionItems(threads.getState()) : [];
  const counts = countByBaseStatus(items, unreadSet);
  return <SidebarFooterView counts={counts} />;
}
