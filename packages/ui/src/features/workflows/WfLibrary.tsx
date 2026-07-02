/**
 * WfLibrary — the workflow library surface.
 *
 * Lists all workflows with scope filter (All / This project / Global),
 * a "New workflow" button, and per-row Run + Edit actions.
 *
 * Run path: direct run only (no inputs form — WorkflowSummary doesn't yet
 * expose declared inputs; that is deferred to when the daemon adds that field).
 */
import React, { useMemo, useState } from 'react';
import { Plus, Play, Pencil, Calendar, Zap, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsModal } from './use-workflows-modal';
import * as wfApi from '@/lib/api/workflows';
import { getRunStatusMeta, formatAgo } from './glyphs';
import { useProjects } from '@/features/sessions/use-projects';
import type { WorkflowSummary, WorkflowRunSummary } from '@qlan-ro/mainframe-types';

// ── Trigger kind → icon + default label map ────────────────────────────────────

type TriggerKind = 'manual' | 'schedule' | 'event' | 'webhook';

const TRIGGER_META: Record<
  TriggerKind,
  { Icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>; label: string }
> = {
  manual: { Icon: Play, label: 'Manual' },
  schedule: { Icon: Calendar, label: 'Schedule' },
  event: { Icon: Zap, label: 'Event' },
  webhook: { Icon: Globe, label: 'Webhook' },
};

// ── Trigger chips ──────────────────────────────────────────────────────────────

interface TriggerChipsProps {
  triggers: WorkflowSummary['triggers'];
}

function WfTriggerChips({ triggers }: TriggerChipsProps): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap items-center gap-[6px]">
      {triggers.map((t, i) => {
        const meta = TRIGGER_META[t.kind as TriggerKind] ?? TRIGGER_META.event;
        const { Icon, label: defaultLabel } = meta;
        return (
          <span
            key={i}
            className="inline-flex h-5 items-center gap-[5px] rounded-full bg-muted px-[9px] text-caption font-medium text-muted-foreground whitespace-nowrap"
          >
            <Icon size={10} className="text-mf-text-3" aria-hidden />
            {defaultLabel}
          </span>
        );
      })}
    </span>
  );
}

// ── Library row ────────────────────────────────────────────────────────────────

interface WfLibraryRowProps {
  wf: WorkflowSummary;
  lastRun: WorkflowRunSummary | undefined;
  port: number;
  projectName?: string;
}

function WfLibraryRow({ wf, lastRun, port, projectName }: WfLibraryRowProps): React.ReactElement {
  const { openRun, openEditor } = useWorkflowsModal();
  const [running, setRunning] = useState(false);

  const isGlobal = wf.projectId === null;

  async function handleRun(): Promise<void> {
    if (running) return;
    setRunning(true);
    try {
      const newRun = await wfApi.startRun(port, wf.id);
      openRun(newRun.id);
    } catch (err) {
      console.warn('[WfLibraryRow] startRun failed:', err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      data-testid={`workflows-library-row-${wf.id}`}
      className="flex items-center gap-[13px] border-b border-border px-[18px] py-[13px] transition-colors hover:bg-accent"
    >
      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Name row */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-bold tracking-tight text-foreground">{wf.name}</span>
          {/* Scope pill — global uses muted #7a4d9e per prototype */}
          <span
            className={cn(
              'inline-flex h-[17px] shrink-0 items-center gap-1 rounded-xs px-[7px]',
              'text-micro font-bold uppercase tracking-[0.3px] whitespace-nowrap',
              isGlobal ? 'bg-[#7a4d9e]/10 text-[#7a4d9e]' : 'bg-primary/10 text-primary',
            )}
          >
            {isGlobal ? 'Global' : (projectName ?? 'Project')}
          </span>
        </div>

        {/* Description */}
        {wf.description && (
          <div className="mt-[3px] max-w-[560px] truncate text-caption leading-[1.45] text-muted-foreground">
            {wf.description}
          </div>
        )}

        {/* Trigger chips + last run */}
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          {wf.triggers.length > 0 && <WfTriggerChips triggers={wf.triggers} />}
          {lastRun && (
            <span className="inline-flex items-center gap-[5px] text-micro text-mf-text-3">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  getRunStatusMeta(lastRun.status).colorClass.replace('text-', 'bg-'),
                )}
              />
              Last run {formatAgo(lastRun.startedAt)}
              {lastRun.status === 'waiting' && ' · waiting on you'}
            </span>
          )}
        </div>
      </div>

      {/* Run button */}
      <button
        type="button"
        data-testid={`workflows-library-run-${wf.id}`}
        disabled={running}
        onClick={() => void handleRun()}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md px-[13px] py-0',
          'h-[30px] text-label font-semibold transition-colors',
          'bg-primary/10 text-primary hover:bg-primary hover:text-white',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Play size={11} aria-hidden />
        Run
      </button>

      {/* Edit button */}
      <button
        type="button"
        data-testid={`workflows-library-edit-${wf.id}`}
        title="Edit definition"
        onClick={() => openEditor({ mode: 'edit', workflowId: wf.id })}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mf-text-3 transition-colors hover:bg-muted"
      >
        <Pencil size={13} aria-hidden />
      </button>
    </div>
  );
}

// ── Scope filter ids ───────────────────────────────────────────────────────────

type ScopeFilter = 'all' | 'project' | 'global';

const SCOPE_FILTERS: Array<{ id: ScopeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'project', label: 'This project' },
  { id: 'global', label: 'Global' },
];

// ── WfLibrary (surface root) ───────────────────────────────────────────────────

interface WfLibraryProps {
  port: number;
}

export function WfLibrary({ port }: WfLibraryProps): React.ReactElement {
  const { openEditor } = useWorkflowsModal();
  const workflows = useWorkflowsStore((s) => s.workflows);
  const runs = useWorkflowsStore((s) => s.runs);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const { projects } = useProjects();

  const projectNameOf = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (projectId: string): string => map.get(projectId) ?? projectId;
  }, [projects]);

  const shown = workflows.filter((w) => {
    if (scope === 'all') return true;
    if (scope === 'global') return w.projectId === null;
    return w.projectId !== null;
  });

  function getLastRun(workflowId: string): WorkflowRunSummary | undefined {
    return runs.filter((r) => r.workflowId === workflowId)[0];
  }

  return (
    <div data-testid="workflows-library" className="flex h-full min-h-0 flex-col bg-card">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-[18px] py-[11px]">
        {SCOPE_FILTERS.map(({ id, label }) => {
          const on = scope === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`workflows-library-scope-${id}`}
              onClick={() => setScope(id)}
              className={cn(
                'inline-flex h-[27px] items-center rounded-full px-[12px] text-label font-medium transition-colors',
                on ? 'bg-primary/10 font-semibold text-primary' : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {label}
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          data-testid="workflows-library-new"
          onClick={() => openEditor({ mode: 'new' })}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-primary px-[13px] text-label font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus size={12} aria-hidden />
          New workflow
        </button>
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((wf) => (
          <WfLibraryRow
            key={wf.id}
            wf={wf}
            lastRun={getLastRun(wf.id)}
            port={port}
            projectName={wf.projectId ? projectNameOf(wf.projectId) : undefined}
          />
        ))}
        {shown.length === 0 && <p className="p-6 text-body text-muted-foreground">No workflows found.</p>}
      </div>
    </div>
  );
}
