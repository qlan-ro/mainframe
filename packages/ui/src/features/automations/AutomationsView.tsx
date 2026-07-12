/**
 * AutomationsView — the shell: header + body switch (library | editor | run).
 * Phase 0 ships only the shell; `library/LibraryList` (Phase 1),
 * `editor/AutomationEditor` (Phase 3, lazy-loaded), `run/RunView` (Phase 5,
 * lazy-loaded), and the describe flow (Phase 5, behind `DESCRIBE_ENABLED`)
 * each replace their placeholder body below as they land — the `<Suspense>`
 * boundary is already in place for the two lazy ones.
 */
import React, { Suspense } from 'react';
import { X, Zap } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore, selectPendingInteractionCount } from './data/use-automations-store';

function SectionFallback(): React.ReactElement {
  return <div className="flex flex-1 items-center justify-center text-label text-muted-foreground">Loading…</div>;
}

export function AutomationsView(): React.ReactElement {
  const close = useAutomationsNav((s) => s.close);
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const runId = useAutomationsNav((s) => s.runId);
  const definitions = useAutomationsStore((s) => s.definitions);
  const pending = useAutomationsStore(selectPendingInteractionCount);

  return (
    <div data-testid="automations-view" className="flex h-full min-h-0 flex-col bg-card font-sans">
      <div className="flex h-[50px] flex-shrink-0 items-center gap-[11px] border-b border-border px-[14px]">
        <Hint label="Close">
          <button
            type="button"
            data-testid="automations-close"
            onClick={close}
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X size={15} aria-hidden />
          </button>
        </Hint>
        <Zap size={16} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">Workflows</span>
        <span data-testid="automations-title-count" className="text-caption text-muted-foreground">
          {definitions.length} automation{definitions.length === 1 ? '' : 's'}
          {pending > 0 ? ` · ${pending} need you` : ''}
        </span>
      </div>

      <Suspense fallback={<SectionFallback />}>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {runId ? (
            <div data-testid="automations-section-run" className="text-body text-muted-foreground">
              Run view — coming in a later phase.
            </div>
          ) : editorTarget ? (
            <div data-testid="automations-section-editor" className="text-body text-muted-foreground">
              Editor — coming in a later phase.
            </div>
          ) : (
            <div data-testid="automations-section-library" className="text-body text-muted-foreground">
              {definitions.length === 0
                ? 'No automations yet.'
                : definitions.map((d) => (
                    <div key={d.id} data-testid={`automations-library-row-${d.id}`}>
                      {d.name}
                    </div>
                  ))}
            </div>
          )}
        </div>
      </Suspense>
    </div>
  );
}
