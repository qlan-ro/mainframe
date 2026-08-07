/**
 * THROWAWAY PROTOTYPE — chrome-style session tabs, shared by variants C
 * (title bar) and D (chat header). Real thread list, real switching: tabs are
 * the most-recent sessions plus whatever is active; clicking one calls
 * switchToThread. Close is a local mock (hides the tab for this page load) and
 * "+" is inert — the question is placement and feel, not tab lifecycle.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Hint } from '@v2/components/ui/hint';
import { projectColor } from '@/features/sessions/sidebar/project-color';

const MAX_TABS = 4;

interface TabEntry {
  id: string;
  title: string;
  projectId: string | undefined;
  active: boolean;
}

function useSessionTabs(closed: ReadonlySet<string>): TabEntry[] {
  const activeId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const sessions = threadItems
    .filter((t) => t.status === 'regular' && t.custom != null && !closed.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title ?? 'Untitled',
      projectId: (t.custom as { projectId?: string }).projectId,
      updatedAt: (t.custom as { updatedAt?: number }).updatedAt ?? 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const tabs = sessions.slice(0, MAX_TABS);
  // The active session is always a tab, even when it isn't among the recent N.
  const activeEntry = sessions.find((s) => s.id === activeId);
  if (activeEntry && !tabs.some((t) => t.id === activeEntry.id)) tabs[tabs.length - 1] = activeEntry;
  return tabs.map((t) => ({ ...t, active: t.id === activeId }));
}

export function ProtoSessionTabs({ surface }: { surface: 'titlebar' | 'chatheader' }) {
  const runtime = useAssistantRuntime();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const tabs = useSessionTabs(closed);

  return (
    <div data-testid={`proto-tabs-${surface}`} className="flex h-full min-w-0 flex-1 items-center gap-1 px-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-testid={`proto-tab-${tab.id}`}
          onClick={() => void runtime.threads.switchToThread(tab.id)}
          className={cn(
            'group inline-flex h-7 max-w-45 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-xs',
            tab.active
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={tab.projectId ? { background: projectColor(tab.projectId) } : undefined}
            aria-hidden
          />
          <span className="min-w-0 truncate">{tab.title}</span>
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Close ${tab.title} (mock)`}
            data-testid={`proto-tab-close-${tab.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setClosed(new Set([...closed, tab.id]));
            }}
            className={cn(
              'grid size-4 shrink-0 place-items-center rounded-sm hover:bg-foreground/10',
              tab.active ? '' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <X className="size-3" />
          </span>
        </button>
      ))}
      <Hint label="New session (mock)">
        <button
          type="button"
          data-testid="proto-tab-new"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60"
        >
          <Plus className="size-3.5" />
        </button>
      </Hint>
    </div>
  );
}
