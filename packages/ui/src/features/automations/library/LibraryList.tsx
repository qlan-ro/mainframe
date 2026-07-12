/**
 * LibraryList — the library surface: New + rows, or `BlankState` when there
 * are no automations yet. The toolbar's New button always goes straight to
 * the editor (the "Build it" path) — `BlankState`'s own two-path chooser is
 * reserved for the empty, first-run experience (plan `library/LibraryList.tsx`
 * comment: "BlankState when empty").
 *
 * Loading and error are distinct from "empty": `AutomationsHost` kicks off
 * `loadAll()` on mount, so an empty `definitions` array is ambiguous between
 * "still fetching," "the fetch failed," and "genuinely no automations yet."
 * BlankState only renders once loading has finished without an error.
 */
import React from 'react';
import { Loader2, Plus, TriangleAlert } from 'lucide-react';
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
  const loading = useAutomationsStore((s) => s.loading);
  const error = useAutomationsStore((s) => s.error);
  const loadAll = useAutomationsStore((s) => s.loadAll);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openDescribe = useAutomationsNav((s) => s.openDescribe);

  const handleBuild = (): void => openEditor({ mode: 'new' });

  if (definitions.length === 0 && loading) {
    return (
      <div data-testid="automations-library" className="h-full">
        <div
          data-testid="automations-library-loading"
          className="flex h-full flex-col items-center justify-center gap-[8px]"
        >
          <Loader2 size={16} className="animate-spin text-muted-foreground" aria-hidden />
          <span className="text-label text-muted-foreground">Loading automations…</span>
        </div>
      </div>
    );
  }

  if (definitions.length === 0 && error) {
    return (
      <div data-testid="automations-library" className="h-full">
        <div
          data-testid="automations-library-error"
          className="flex h-full flex-col items-center justify-center gap-[8px] p-[32px] text-center"
        >
          <TriangleAlert size={20} className="text-destructive" aria-hidden />
          <span className="text-body font-semibold text-foreground">Couldn't load your automations</span>
          <span className="max-w-[360px] text-label text-muted-foreground">{error}</span>
          <button
            type="button"
            data-testid="automations-library-retry"
            onClick={() => void loadAll()}
            className="mt-[4px] inline-flex h-[30px] items-center gap-[6px] rounded-md bg-primary px-[13px] text-label font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div data-testid="automations-library" className="h-full">
        <BlankState onDescribe={openDescribe} onBuild={handleBuild} describeEnabled={DESCRIBE_ENABLED} />
      </div>
    );
  }

  return (
    <div data-testid="automations-library" className="flex h-full min-h-0 flex-col">
      {error && (
        <div
          data-testid="automations-library-error-banner"
          className="flex shrink-0 items-center gap-[8px] border-b border-destructive/30 bg-destructive/8 px-[16px] py-[8px]"
        >
          <TriangleAlert size={12} className="shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-caption text-foreground">{error}</span>
          <button
            type="button"
            data-testid="automations-library-error-retry"
            onClick={() => void loadAll()}
            className="shrink-0 text-caption font-semibold text-destructive hover:underline"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-end gap-[10px] border-b border-border px-[16px] py-[14px]">
        <button
          type="button"
          data-testid="automations-library-new"
          onClick={handleBuild}
          className="inline-flex h-[30px] items-center gap-[6px] rounded-md bg-primary px-[13px] text-label font-semibold text-primary-foreground transition-opacity hover:opacity-90"
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
