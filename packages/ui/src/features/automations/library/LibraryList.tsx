/**
 * LibraryList — the library surface: New + rows, or `BlankState` when there
 * are no automations yet. The toolbar's New button always goes straight to
 * the editor (the "Build it" path) — `BlankState`'s own two-path chooser is
 * reserved for the empty, first-run experience (plan `library/LibraryList.tsx`
 * comment: "BlankState when empty").
 */
import React from 'react';
import { Plus } from 'lucide-react';
import type { AutomationRunSummary, AutomationSummary } from '../contract';
import { DESCRIBE_ENABLED } from '../flags';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { LibraryRow } from './LibraryRow';
import { BlankState } from './BlankState';

function mostRecentRun(runs: AutomationRunSummary[], automationId: string): AutomationRunSummary | undefined {
  return runs
    .filter((r) => r.automationId === automationId)
    .reduce<
      AutomationRunSummary | undefined
    >((latest, r) => (!latest || r.startedAt > latest.startedAt ? r : latest), undefined);
}

export function LibraryList(): React.ReactElement {
  const definitions = useAutomationsStore((s) => s.definitions);
  const runs = useAutomationsStore((s) => s.runs);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openDescribe = useAutomationsNav((s) => s.openDescribe);

  const handleBuild = (): void => openEditor({ mode: 'new' });

  if (definitions.length === 0) {
    return (
      <div data-testid="automations-library" className="h-full">
        <BlankState onDescribe={openDescribe} onBuild={handleBuild} describeEnabled={DESCRIBE_ENABLED} />
      </div>
    );
  }

  return (
    <div data-testid="automations-library" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-border px-4 py-2.5">
        <button
          type="button"
          data-testid="automations-library-new"
          onClick={handleBuild}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-primary px-3 text-label font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus size={12} aria-hidden />
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {definitions.map((automation: AutomationSummary) => (
          <LibraryRow key={automation.id} automation={automation} lastRun={mostRecentRun(runs, automation.id)} />
        ))}
      </div>
    </div>
  );
}
