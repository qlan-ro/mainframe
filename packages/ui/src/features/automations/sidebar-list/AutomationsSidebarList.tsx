/**
 * AutomationsSidebarList — the sidebar's Automations view (the nav rail's
 * third list). Header: "Automations" + the shared scope strip (D7). "New
 * automation" is its own action row (`NewAutomationRow`, mirroring Chats'
 * `NewSessionRow`) — there is no "Open the library" affordance any more
 * (2026-10 redesign: the body never lists automations, so there is nothing
 * to open). Rows come from the D7 scope-resolution helper
 * (`useScopedAutomationsLibrary`, shared with the body) — the sole project's
 * library, 'all', or 'all' filtered to the scope. A row opens the
 * automation's details in the body; "needs you" rows sort first. The
 * pending dot lives on the rail.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import { SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { SidebarScopeStrip } from '@/features/sessions/SidebarScopeStrip';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { useScopedAutomationsLibrary } from '../data/use-automations-scope';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { AutomationSidebarRow } from './AutomationSidebarRow';
import { deriveAutomationRows } from './automation-row-view';

const TICK_MS = 30_000;

/** Re-renders every 30s so the "last ran" column keeps counting while the list is idle. */
function useTickingNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The "New automation" row under the header — ONE CLICK, always, mirroring Chats' `NewSessionRow`. */
function NewAutomationRow({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton className="pl-1" data-testid="automations-sidebar-new" onClick={onClick}>
          <Zap />
          <span className="min-w-0 flex-1 truncate">New automation</span>
          <Plus aria-hidden className="shrink-0 text-muted-foreground" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AutomationsSidebarList() {
  const library = useScopedAutomationsLibrary();
  const interactions = useAutomationsStore((s) => s.interactions);
  const openHost = useAutomationsNav((s) => s.openHost);
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const describeOpen = useAutomationsNav((s) => s.describeOpen);
  const detailsAutomationId = useAutomationsNav((s) => s.detailsAutomationId);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openDetails = useAutomationsNav((s) => s.openDetails);
  const now = useTickingNow();
  const rows = useMemo(
    () => deriveAutomationRows(library.definitions, library.runs, interactions),
    [library.definitions, library.runs, interactions],
  );

  // Highlights the row for whatever the body is actually showing: editing an
  // existing automation keeps its row lit (details stays open underneath it,
  // 2026-10 redesign); a brand-new draft or Describe lights nothing, even if
  // some other row's details happened to be open a moment ago.
  const activeAutomationId =
    editorTarget?.mode === 'edit'
      ? editorTarget.automationId
      : editorTarget != null || describeOpen
        ? null
        : detailsAutomationId;

  const openNew = () => {
    openHost();
    openEditor({ mode: 'new' });
  };

  return (
    <>
      <SidebarHeader className="gap-3">
        <div className="flex h-9 items-center pl-1">
          <span className="text-base font-semibold">Automations</span>
        </div>
        <NewAutomationRow onClick={openNew} />
        <SidebarScopeStrip />
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="flex flex-col gap-0.5 px-2">
          {library.loading && rows.length === 0 ? (
            <div
              data-testid="automations-sidebar-loading"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              Loading automations…
            </div>
          ) : library.error && rows.length === 0 ? (
            <div data-testid="automations-sidebar-error" className="px-2 py-6 text-center text-xs text-destructive">
              {library.error}
            </div>
          ) : rows.length === 0 ? (
            <div
              data-testid="automations-sidebar-empty"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              No automations yet.
            </div>
          ) : (
            rows.map((row) => (
              <AutomationSidebarRow
                key={row.id}
                row={row}
                now={now}
                selected={row.id === activeAutomationId}
                onOpen={() => {
                  openHost();
                  openDetails(row.id);
                }}
              />
            ))
          )}
        </div>
      </SidebarScrollRegion>
    </>
  );
}
