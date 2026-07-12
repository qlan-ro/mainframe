/**
 * AutomationsHost — single app-root outlet for the Automations v2 fullview
 * host, mirroring `WorkflowsModalHost`'s role but driven by
 * `use-automations-nav` instead of a WorkflowsModalHost-style event.
 *
 * v1 Workflows stays wired to its own `mf:open-workflows` event untouched;
 * this host has no production entry point yet (that's Phase 6's
 * SidebarHeader swap). Until then, a dev-only affordance
 * (Cmd/Ctrl+Shift+A, `import.meta.env.DEV` only) opens it for manual
 * verification.
 */
import React, { Suspense, useEffect } from 'react';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore } from './data/use-automations-store';
import { useAutomationToasts } from './data/use-automation-toasts';
import { AutomationsView } from './AutomationsView';

export function AutomationsHost(): React.ReactElement | null {
  const open = useAutomationsNav((s) => s.open);
  const openHost = useAutomationsNav((s) => s.openHost);
  const close = useAutomationsNav((s) => s.close);
  const loadAll = useAutomationsStore((s) => s.loadAll);

  // Unconditional (before the `!open` early return) — notifications fire even while the panel is closed.
  useAutomationToasts();

  useEffect(() => {
    if (open) void loadAll();
  }, [open, loadAll]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openHost();
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openHost, close]);

  if (!open) return null;

  return (
    <div
      data-testid="automations-host"
      className="fixed inset-0 z-[4600] flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] max-h-[880px] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl bg-card shadow-xl"
      >
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-label text-muted-foreground">Loading…</div>
          }
        >
          <AutomationsView />
        </Suspense>
      </div>
    </div>
  );
}
