/**
 * AutomationsHost — single app-root outlet for the Automations v2 fullview
 * host, mounted unconditionally in AppShell (Phase 6 entry swap) and driven
 * by `use-automations-nav`.
 *
 * A dev-only affordance (Cmd/Ctrl+Shift+A, `import.meta.env.DEV` only) still
 * opens it directly, alongside the production SidebarHeader entry point.
 *
 * The host owns the library's project scope for exactly as long as it is open:
 * seeded from the sidebar filter on each open, changed only by the header
 * picker, and dropped on close.
 */
import React, { Suspense, useEffect } from 'react';
// Radix replaces the v1 hand-rolled overlay — focus trap, scroll lock and
// layering come with it, and Escape now closes in production too (the old
// manual handler was dev-only).
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalProjectScope } from '@/features/project-scope/use-modal-project-scope';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore } from './data/use-automations-store';
import { useAutomationToasts } from './data/use-automation-toasts';
import { useAutomationEvents } from './data/use-automation-events';
import { AutomationsView } from './AutomationsView';

export function AutomationsHost(): React.ReactElement | null {
  const open = useAutomationsNav((s) => s.open);
  const openHost = useAutomationsNav((s) => s.openHost);
  const close = useAutomationsNav((s) => s.close);
  const loadInteractions = useAutomationsStore((s) => s.loadInteractions);
  const loadLibrary = useAutomationsStore((s) => s.loadLibrary);
  const setScopeProjectId = useAutomationsStore((s) => s.setScopeProjectId);
  const { projectId, setProjectId } = useModalProjectScope(open);

  // Both unconditional (before the `!open` early return): toasts fire, and
  // the WS-driven store patches apply, even while the panel is closed.
  useAutomationToasts();
  useAutomationEvents();

  // The sidebar's pending-interaction badge (`selectPendingInteractionCount`)
  // is alive whether or not this modal ever opens, so its load runs from boot
  // and fetches nothing else.
  useEffect(() => {
    void loadInteractions();
  }, [loadInteractions]);

  // Keyed on the scope itself, not on the rising edge of `open`: the seed can
  // land a render late (the projects list arrives after the modal), and the
  // header picker changes it mid-open. While closed the store holds no scope —
  // a load with a null project would fetch every project's automations.
  useEffect(() => {
    if (!open) {
      setScopeProjectId(null);
      return;
    }
    setScopeProjectId(projectId);
    void loadLibrary(projectId);
  }, [open, projectId, setScopeProjectId, loadLibrary]);

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
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading…</div>
          }
        >
          <AutomationsView projectId={projectId} onProjectChange={setProjectId} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
