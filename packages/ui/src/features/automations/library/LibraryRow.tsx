/**
 * LibraryRow — one automation in the library: name, scope badge, description,
 * trigger chips, last-run pill, Run now, Edit, enabled toggle.
 *
 * Owns its own async gateway calls (toggle/run), mirroring the v1
 * `WfLibraryRow` pattern — this is thin fetch-and-patch glue, not domain
 * logic, so it stays in the component rather than `domain/`.
 */
import React, { useState } from 'react';
import { Calendar, Globe, Pencil, Play, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { mfToast } from '@/lib/toast';
import type { AutomationRunSummary, AutomationSummary, AutomationTrigger } from '../contract';
import { summarizeTrigger } from '../domain/trigger-summary';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { LastRunPill } from './LastRunPill';

const TRIGGER_ICON: Record<
  AutomationTrigger['kind'],
  React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
> = {
  schedule: Calendar,
  event: Zap,
  webhook: Globe,
};

function TriggerChips({ triggers }: { triggers: AutomationTrigger[] }): React.ReactElement | null {
  if (triggers.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {triggers.map((trigger) => {
        const Icon = TRIGGER_ICON[trigger.kind];
        return (
          <span
            key={trigger.id}
            className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground"
          >
            <Icon size={11} aria-hidden />
            {summarizeTrigger(trigger)}
          </span>
        );
      })}
    </span>
  );
}

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
        'flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent',
        !automation.enabled && 'opacity-60',
      )}
    >
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Zap size={16} className="text-primary" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-semibold tracking-tight text-foreground">{automation.name}</span>
          <Badge variant="secondary" className="shrink-0">
            {automation.scope === 'global' ? 'Global' : 'Project'}
          </Badge>
        </div>
        {automation.description && (
          <div className="mt-0.5 max-w-[560px] truncate text-label text-muted-foreground">{automation.description}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <TriggerChips triggers={automation.definition.triggers} />
          <LastRunPill automationId={automation.id} run={lastRun} onOpen={openRun} />
        </div>
      </div>

      <button
        type="button"
        data-testid={`automations-library-run-${automation.id}`}
        disabled={running}
        onClick={() => void handleRun()}
        className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md bg-primary/10 px-3 text-label font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Play size={11} aria-hidden />
        Run
      </button>

      <Hint label="Edit">
        <button
          type="button"
          data-testid={`automations-library-edit-${automation.id}`}
          onClick={() => openEditor({ mode: 'edit', automationId: automation.id })}
          className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
  );
}
