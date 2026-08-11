/**
 * LibraryRow — one automation in the library: name, description, trigger
 * chips, last-run pill, Run now, Edit, enabled toggle. Clicking the row
 * itself (outside those explicit controls) opens the automation's details
 * view (todo #233) — straight to its one run, to the Runs tab if there's
 * history to browse, or to Overview if it's never run.
 *
 * The project badge names the automation's own project. The daemon list is
 * scoped to the active project PLUS unscoped (projectId null) automations,
 * so the badge is what distinguishes "yours" from "everywhere".
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
import { Pencil, Play, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Switch } from '@/components/ui/switch';
import { mfToast } from '@/lib/toast';
import { requestConfirm } from '@/lib/confirm-bridge';
import { useProjects } from '@/features/sessions/use-projects';
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
  const removeDefinition = useAutomationsStore((s) => s.removeDefinition);
  const runCount = useAutomationsStore((s) => s.runs.filter((r) => r.automationId === automation.id).length);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const openRun = useAutomationsNav((s) => s.openRun);
  const openDetails = useAutomationsNav((s) => s.openDetails);
  const { projects } = useProjects();
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const projectName =
    automation.projectId == null
      ? 'All projects'
      : (projects.find((p) => p.id === automation.projectId)?.name ?? automation.projectId);

  function handleRowClick(): void {
    if (runCount === 1 && lastRun) openRun(lastRun.id);
    else openDetails(automation.id);
  }

  function stopAnd(handler: (e: React.MouseEvent) => void): (e: React.MouseEvent) => void {
    return (e) => {
      e.stopPropagation();
      handler(e);
    };
  }

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

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    const confirmed = await requestConfirm({
      title: `Delete "${automation.name}"?`,
      body: 'The automation and its run history are removed. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      testid: 'automations-delete-confirm',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await gateway.deleteAutomation(automation.id);
      removeDefinition(automation.id);
    } catch (err) {
      mfToast.error('Could not delete the automation', { description: errorMessage(err) });
    } finally {
      setDeleting(false);
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
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRowClick();
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-[13px] border-b border-border px-[16px] py-[13px] transition-colors hover:bg-accent',
        !automation.enabled && 'opacity-60',
      )}
    >
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Zap size={16} className="text-primary" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">{automation.name}</span>
          <span
            data-testid={`automations-library-project-${automation.id}`}
            className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-muted px-[7px] text-xs text-muted-foreground"
          >
            {projectName}
          </span>
        </div>
        {automation.description && (
          <div className="mt-[2px] truncate text-xs text-muted-foreground">{automation.description}</div>
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
          onClick={stopAnd(() => void handleRun())}
          className="inline-flex h-[28px] shrink-0 items-center gap-[5px] rounded-md border-[0.5px] border-border bg-transparent px-[11px] text-xs font-semibold text-muted-foreground transition-colors group-hover:bg-card hover:bg-card disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play size={12} className="fill-current text-primary" aria-hidden />
          Run
        </button>

        <Hint label="Edit">
          <button
            type="button"
            data-testid={`automations-library-edit-${automation.id}`}
            onClick={stopAnd(() => openEditor({ mode: 'edit', automationId: automation.id }))}
            className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil size={13} aria-hidden />
          </button>
        </Hint>

        <Hint label="Delete">
          <button
            type="button"
            data-testid={`automations-library-delete-${automation.id}`}
            disabled={deleting}
            onClick={stopAnd(() => void handleDelete())}
            className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-45"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </Hint>

        <Switch
          data-testid={`automations-library-toggle-${automation.id}`}
          checked={automation.enabled}
          disabled={toggling}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(next) => void handleToggle(next)}
        />
      </div>
    </div>
  );
}
