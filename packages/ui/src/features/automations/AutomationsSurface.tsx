/**
 * AutomationsSurface — the body's Automations view (the `SidebarInset`
 * content while `sidebarView` is 'automations', D1). Keeps the store's
 * `scopeProjectId` in sync with D7's shared session scope for as long as
 * this surface is mounted — the editor's save target and the project-scoped
 * field pickers (skills/files/branches) read it — then renders
 * `AutomationsView`. Mirrors the old `AutomationsHost`'s scope-sync effect,
 * just driven by the session scope instead of a modal-local pick.
 */
import React, { Suspense, useEffect } from 'react';
import { useAutomationsStore } from './data/use-automations-store';
import { useScopedAutomationsLibrary } from './data/use-automations-scope';
import { AutomationsView } from './AutomationsView';

export function AutomationsSurface(): React.ReactElement {
  const setScopeProjectId = useAutomationsStore((s) => s.setScopeProjectId);
  const { loadProjectId } = useScopedAutomationsLibrary();

  useEffect(() => {
    setScopeProjectId(loadProjectId);
    return () => setScopeProjectId(null);
  }, [loadProjectId, setScopeProjectId]);

  return (
    <Suspense
      fallback={<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading…</div>}
    >
      <AutomationsView />
    </Suspense>
  );
}
