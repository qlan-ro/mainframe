/**
 * AutomationsHost — single app-root outlet for the Automations v2 fullview
 * host, mounted unconditionally in AppShell (Phase 6 entry swap) and driven
 * by `use-automations-nav`.
 *
 * A dev-only affordance (Cmd/Ctrl+Shift+A, `import.meta.env.DEV` only) still
 * opens it directly, alongside the production SidebarHeader entry point.
 */
import React, { Suspense, useEffect } from 'react';
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

  // Both unconditional (before the `!open` early return): toasts fire, and
  // the WS-driven store patches apply, even while the panel is closed.
  useAutomationToasts();
  useAutomationEvents();

  // Load once at mount (not gated by `open`) — the sidebar's pending-
  // interaction badge (`selectPendingInteractionCount`) needs real data from
  // app boot, not just after the panel has been opened once. WS events keep
  // it fresh thereafter via useAutomationEvents above.
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
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
