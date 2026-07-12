/**
 * LibraryRow — one automation in the library: name, scope badge, description,
 * trigger chips, last-run pill, Run now, Edit, enabled toggle.
 *
 * Owns its own async gateway calls (toggle/run), mirroring the v1
 * `WfLibraryRow` pattern — this is thin fetch-and-patch glue, not domain
 * logic, so it stays in the component rather than `domain/`.
 *
 * Layout is two-tier, matching `WfLibraryRow`: the outer row gaps icon /
 * content / actions at 13px, and the actions group (Run · Edit · toggle)
 * gaps its own children at 6px — a single flat gap collapses that rhythm.
 */
import React, { useState } from 'react';
import { Pencil, Play, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Switch } from '@/components/ui/switch';
import { mfToast } from '@/lib/toast';
import type { AutomationRunSummary, AutomationSummary } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { LastRunPill } from './LastRunPill';
import { TriggerChips } from './TriggerChips';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

interface LibraryRowProps {
  automation: AutomationSummary;
  lastRun?: AutomationRunSummary;
}

export function LibraryRow({ automation, lastRun }: LibraryRowProps): React.ReactElement {
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchDefinition = useAutomationsStore((s) => s.patchDefinition);
  const patchRun = useAutomationsStore((s) => s.patchRun);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openRun = useAutomationsNav((s) => s.openRun);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);

  async function handleToggle(next: boolean): Promise<void> {
    if (toggling) return;
    setToggling(true);
    try {
      patchDefinition(await gateway.setEnabled(automation.id, next));
    } catch (err) {
      mfToast.error('Could not update the automation', { description: errorMessage(err) });
    } finally {
      setToggling(false);
    }
  }

  async function handleRun(): Promise<void> {
    if (running) return;
    setRunning(true);
    try {
      const run = await gateway.startRun(automation.id);
      patchRun(run);
      openRun(run.id);
    } catch (err) {
      mfToast.error('Could not start the run', { description: errorMessage(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      data-testid={`automations-library-row-${automation.id}`}
      className={cn(
        'group flex items-center gap-[13px] border-b border-border px-[16px] py-[13px] transition-colors hover:bg-accent',
        !automation.enabled && 'opacity-60',
      )}
    >
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Zap size={16} className="text-primary" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-body font-semibold tracking-tight text-foreground">{automation.name}</span>
          <span className="inline-flex h-[16px] shrink-0 items-center rounded-xs bg-muted px-[6px] text-caption font-medium text-muted-foreground">
            {automation.scope === 'global' ? 'Global' : 'Project'}
          </span>
        </div>
        {automation.description && (
          <div className="mt-[2px] truncate text-label text-muted-foreground">{automation.description}</div>
        )}
        <div className="mt-[7px] flex flex-wrap items-center gap-[7px]">
          <TriggerChips triggers={automation.definition.triggers} />
          <LastRunPill automationId={automation.id} run={lastRun} onOpen={openRun} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[6px]">
        <button
          type="button"
          data-testid={`automations-library-run-${automation.id}`}
          disabled={running}
          title="Run now"
          onClick={() => void handleRun()}
          className="inline-flex h-[28px] shrink-0 items-center gap-[5px] rounded-md border-[0.5px] border-border bg-transparent px-[11px] text-label font-semibold text-muted-foreground transition-colors group-hover:bg-card hover:bg-card disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play size={12} className="fill-current text-primary" aria-hidden />
          Run
        </button>

        <Hint label="Edit">
          <button
            type="button"
            data-testid={`automations-library-edit-${automation.id}`}
            onClick={() => openEditor({ mode: 'edit', automationId: automation.id })}
            className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil size={13} aria-hidden />
          </button>
        </Hint>

        <Switch
          data-testid={`automations-library-toggle-${automation.id}`}
          checked={automation.enabled}
          disabled={toggling}
          onCheckedChange={(next) => void handleToggle(next)}
        />
      </div>
    </div>
  );
}
