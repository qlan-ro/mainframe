/**
 * DetailsHeaderActions — the Details header's action cluster: the project
 * scope chip, enable/disable toggle, Run now, Edit and Delete (through the
 * shared ConfirmDialog). Ported from the old `LibraryRow`'s per-row actions
 * now that rows carry none of their own (the sidebar list has no actions,
 * 2026-10 redesign) — same async toggle/run/delete pattern, just portaled
 * into the view's header instead of a row.
 */
import { useState } from 'react';
import { Pencil, Play, Trash2 } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { Switch } from '@/components/ui/switch';
import { mfToast } from '@/lib/toast';
import { requestConfirm } from '@/lib/confirm-bridge';
import { useProjects } from '@/features/sessions/use-projects';
import type { AutomationSummary } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export interface DetailsHeaderActionsProps {
  automation: AutomationSummary;
}

export function DetailsHeaderActions({ automation }: DetailsHeaderActionsProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchDefinition = useAutomationsStore((s) => s.patchDefinition);
  const patchRun = useAutomationsStore((s) => s.patchRun);
  const removeDefinition = useAutomationsStore((s) => s.removeDefinition);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const closeDetails = useAutomationsNav((s) => s.closeDetails);
  const selectRun = useAutomationsNav((s) => s.selectRun);
  const { projects } = useProjects();
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const projectName =
    automation.projectId == null
      ? 'All projects'
      : (projects.find((p) => p.id === automation.projectId)?.name ?? automation.projectId);

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
      selectRun(run.id);
    } catch (err) {
      mfToast.error('Could not start the run', { description: errorMessage(err) });
    } finally {
      setRunning(false);
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
      closeDetails();
    } catch (err) {
      mfToast.error('Could not delete the automation', { description: errorMessage(err) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <span
        data-testid="automations-details-project"
        className="inline-flex h-[20px] shrink-0 items-center rounded-full bg-muted px-[8px] text-xs text-muted-foreground"
      >
        {projectName}
      </span>
      <button
        type="button"
        data-testid="automations-details-run"
        disabled={running}
        onClick={() => void handleRun()}
        className="inline-flex h-[28px] shrink-0 items-center gap-[5px] rounded-md border-[0.5px] border-border px-[12px] text-xs font-semibold text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Play size={14} className="text-primary" fill="currentColor" aria-hidden />
        Run now
      </button>
      <Hint label="Edit">
        <button
          type="button"
          data-testid="automations-details-edit"
          onClick={() => openEditor({ mode: 'edit', automationId: automation.id })}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent"
        >
          <Pencil size={14} aria-hidden />
        </button>
      </Hint>
      <Hint label="Delete">
        <button
          type="button"
          data-testid="automations-details-delete"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-45"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </Hint>
      <Switch
        data-testid="automations-details-toggle"
        checked={automation.enabled}
        disabled={toggling}
        onCheckedChange={(next) => void handleToggle(next)}
      />
    </>
  );
}
