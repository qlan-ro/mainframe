import { useAssistantRuntime } from '@assistant-ui/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConnectionStatus, type ConnectionStatus } from '@/app/ConnectionStatusContext';
import { useUnreadStore } from '@/store/unread-store';
import { threadListStateToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { countByBaseStatus, type BaseStatusCounts } from '@/features/sessions/view-model/count-by-base-status';

const PIP: Record<ConnectionStatus['state'], string> = {
  connected: 'bg-mf-success',
  connecting: 'bg-mf-warning',
  disconnected: 'bg-destructive',
};

const COUNT_META: { key: keyof BaseStatusCounts; label: string; dot: string }[] = [
  { key: 'working', label: 'Working', dot: 'bg-primary animate-pulse' },
  { key: 'waiting', label: 'Waiting for you', dot: 'bg-mf-warning' },
  { key: 'idle', label: 'Idle', dot: 'bg-mf-text-4' },
];

export function SidebarFooterView({ connection, counts }: { connection: ConnectionStatus; counts: BaseStatusCounts }) {
  return (
    <div
      data-testid="sidebar-footer"
      className="flex h-[25px] flex-shrink-0 items-center gap-2 px-3 text-micro text-mf-text-3"
    >
      <span className="flex items-center gap-1.5">
        <span data-testid="sidebar-footer-connection" className={`size-1.5 rounded-full ${PIP[connection.state]}`} />
        <span>{connection.state === 'connected' ? 'Connected' : connection.daemonStatus}</span>
      </span>
      <span className="flex-1" />
      {COUNT_META.filter((m) => counts[m.key] > 0).map((m) => (
        <Tooltip key={m.key}>
          <TooltipTrigger asChild>
            <span data-testid={`sidebar-footer-count-${m.key}`} className="flex items-center gap-1 tabular-nums">
              <span className={`size-1.5 rounded-full ${m.dot}`} />
              {counts[m.key]}
            </span>
          </TooltipTrigger>
          <TooltipContent>{m.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * Self-sufficient sidebar chrome footer: connection pip + per-status session
 * counts. Derives its own counts from the thread list so it composes directly
 * under `SidebarShell` without the sessions feature threading props in.
 */
export function SidebarFooter() {
  const connection = useConnectionStatus();
  const threads = useAssistantRuntime().threads;
  const unreadSet = useUnreadStore((s) => s.unread);
  // Recompute each render (getState() is a snapshot); the SidebarShell re-render
  // cascade keeps it as fresh as the old SessionSidebar-owned footer was.
  const items = threads ? threadListStateToSessionItems(threads.getState()) : [];
  const counts = countByBaseStatus(items, unreadSet);
  return <SidebarFooterView connection={connection} counts={counts} />;
}
