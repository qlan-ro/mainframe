/**
 * AutomationsSidebarList — the sidebar's Automations view (the nav rail's
 * third list). Header: "Automations" + the shared scope strip (D7) + Open
 * library + New. Rows come from the D7 scope-resolution helper
 * (`useScopedAutomationsLibrary`, shared with the body) — the sole project's
 * library, 'all', or 'all' filtered to the scope. A row opens the
 * automation's details in the body; "needs you" rows sort first. The
 * pending dot lives on the rail.
 */
import { useEffect, useMemo, useState } from 'react';
import { LayoutList, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { SidebarHeader } from '@/components/ui/sidebar';
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

export function AutomationsSidebarList() {
  const library = useScopedAutomationsLibrary();
  const interactions = useAutomationsStore((s) => s.interactions);
  const openHost = useAutomationsNav((s) => s.openHost);
  const close = useAutomationsNav((s) => s.close);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openDetails = useAutomationsNav((s) => s.openDetails);
  const now = useTickingNow();
  const rows = useMemo(
    () => deriveAutomationRows(library.definitions, library.runs, interactions),
    [library.definitions, library.runs, interactions],
  );

  // Returns the body to the bare library — clears whatever sub-view (editor,
  // run, describe, details) was left open, rather than resuming it.
  const openLibrary = () => {
    openHost();
    close();
  };

  const openNew = () => {
    openHost();
    openEditor({ mode: 'new' });
  };

  return (
    <>
      <SidebarHeader className="gap-3">
        <div className="flex h-9 items-center justify-between pl-1">
          <span className="text-base font-semibold">Automations</span>
          <div className="flex items-center">
            {/* The bare library (run / toggle / delete per row) has no other
                production entry point: rows open Details, New opens the editor. */}
            <Hint label="Open the library">
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="automations-sidebar-open-library"
                aria-label="Open the library"
                className="text-muted-foreground"
                onClick={openLibrary}
              >
                <LayoutList />
              </Button>
            </Hint>
            <Hint label="New automation">
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="automations-sidebar-new"
                aria-label="New automation"
                className="text-muted-foreground"
                onClick={openNew}
              >
                <Plus />
              </Button>
            </Hint>
          </div>
        </div>
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
