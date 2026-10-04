/**
 * AutomationsHost — single app-root outlet for the Automations v2 fullview
 * host, mounted unconditionally in AppShell (Phase 6 entry swap) and driven
 * by `use-automations-nav`.
 *
 * A dev-only affordance (⌘⇧A, marked `dev` in the shortcut registry) still
 * opens it directly, alongside the production SidebarHeader entry point.
 *
 * The host owns the library's project scope for exactly as long as it is open:
 * seeded from the sidebar filter on each open, changed only by the header
 * picker, and dropped on close. The always-on concerns (toasts, WS patches,
 * the pending-interaction load) live in `AutomationsRuntime`, not here.
 */
import React, { Suspense, useEffect } from 'react';
// Radix replaces the v1 hand-rolled overlay — focus trap, scroll lock and
// layering come with it, and Escape now closes in production too (the old
// manual handler was dev-only).
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalProjectScope } from '@/features/project-scope/use-modal-project-scope';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore } from './data/use-automations-store';
import { useAutomationsLibrary } from './data/use-automations-library';
import { AutomationsView } from './AutomationsView';
import { useShortcutAction } from '@/features/shortcuts/action-store';

export function AutomationsHost(): React.ReactElement | null {
  const open = useAutomationsNav((s) => s.open);
  const openHost = useAutomationsNav((s) => s.openHost);
  const close = useAutomationsNav((s) => s.close);
  const setScopeProjectId = useAutomationsStore((s) => s.setScopeProjectId);
  const { projectId, setProjectId } = useModalProjectScope(open);
  // The modal's own scope entry; the sidebar list holds its own, so opening
  // here never evicts what the list is showing.
  useAutomationsLibrary(projectId, open);

  // Keyed on the scope itself, not on the rising edge of `open`: the seed can
  // land a render late (the projects list arrives after the modal), and the
  // header picker changes it mid-open. While closed the store holds no scope.
  useEffect(() => {
    setScopeProjectId(open ? projectId : null);
  }, [open, projectId, setScopeProjectId]);

  // The registry's `dev` flag is the only gate on ⌘⇧A now — the dispatcher
  // filters dev entries out of production builds at its one mount site.
  useShortcutAction('app.automations', openHost);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        data-testid="automations-host"
        showCloseButton={false}
        resizeKey="automations"
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
