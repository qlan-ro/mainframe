/**
 * AutomationsHost — single app-root outlet for the Automations v2 fullview
 * host, mounted unconditionally in AppShell (Phase 6 entry swap) and driven
 * by `use-automations-nav`.
 *
 * A dev-only affordance (Cmd/Ctrl+Shift+A, `import.meta.env.DEV` only) still
 * opens it directly, alongside the production SidebarHeader entry point.
 */
import React, { Suspense, useEffect } from 'react';
// v2 shell, legacy body: the workspace inside is still bridge-styled and
// ports with the automations pass. Radix replaces the hand-rolled overlay —
// focus trap, scroll lock and layering come with it, and Escape now closes
// in production too (the old manual handler was dev-only).
import { Dialog, DialogContent, DialogTitle } from '@v2/components/ui/dialog';
import { useActiveIdentity } from '../sessions/use-active-identity';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore } from './data/use-automations-store';
import { useAutomationToasts } from './data/use-automation-toasts';
import { useAutomationEvents } from './data/use-automation-events';
import { AutomationsView } from './AutomationsView';

export function AutomationsHost(): React.ReactElement | null {
  const open = useAutomationsNav((s) => s.open);
  const openHost = useAutomationsNav((s) => s.openHost);
  const close = useAutomationsNav((s) => s.close);
  const loadAll = useAutomationsStore((s) => s.loadAll);
  const setActiveProjectId = useAutomationsStore((s) => s.setActiveProjectId);
  const { projectId } = useActiveIdentity();

  // Both unconditional (before the `!open` early return): toasts fire, and
  // the WS-driven store patches apply, even while the panel is closed.
  useAutomationToasts();
  useAutomationEvents();

  // Resolves + (re)loads on mount AND on every active-project change (not
  // gated by `open`) — the sidebar's pending-interaction badge
  // (`selectPendingInteractionCount`) needs real data from app boot, and
  // automations are project-scoped non-configurably (todo #234 bullet 1), so
  // switching projects must re-scope the list. `setActiveProjectId` runs
  // first so `loadAll`'s `get().activeProjectId` read sees the fresh value.
  // WS events keep things fresh thereafter via useAutomationEvents above.
  useEffect(() => {
    setActiveProjectId(projectId ?? null);
    void loadAll();
  }, [projectId, setActiveProjectId, loadAll]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openHost();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openHost]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        data-testid="automations-host"
        showCloseButton={false}
        // No autofocus: the first focusable is the header's Hint-wrapped close
        // button, and focusing it opens its tooltip — whose layer then eats
        // the first Escape meant for the dialog.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[88vh] max-h-[880px] w-full flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[1040px]"
      >
        <DialogTitle className="sr-only">Automations</DialogTitle>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-label text-muted-foreground">Loading…</div>
          }
        >
          <AutomationsView />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
