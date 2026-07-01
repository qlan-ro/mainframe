/**
 * WfRunsList — Runs section list view.
 *
 * Renders two sticky groups (Active & waiting / Recent) with filter chips
 * (All / Waiting / Running / Failed / Done). Clicking a row opens the run detail.
 *
 * Ported from prototype WfRunsList + WfRunRow (18-workflows.jsx), translating
 * inline styles to Tailwind tokens per the Token Map in the plan.
 */
import React, { useState } from 'react';
import { ChevronRight, Layers, Play, Calendar, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsModal } from './use-workflows-modal';
import { WfStatusPip, WfStatusTag } from './WfStatus';
import { formatAgo } from './glyphs';
import type { WorkflowRunSummary } from '@qlan-ro/mainframe-types';

// ── Trigger icon map ──────────────────────────────────────────────────────────

// A run's triggerKind is the mechanism that started it (engine emits these),
// distinct from a workflow's definition triggers (manual|schedule|event|webhook).
const TRIGGER_ICON: Record<WorkflowRunSummary['triggerKind'], React.ReactElement> = {
  manual: <Play size={10} className="text-mf-text-4" aria-hidden />,
  cron: <Calendar size={10} className="text-mf-text-4" aria-hidden />,
  event: <Zap size={10} className="text-mf-text-4" aria-hidden />,
  call: <Layers size={10} className="text-mf-text-4" aria-hidden />,
};

const TRIGGER_LABEL: Record<WorkflowRunSummary['triggerKind'], string> = {
  manual: 'Manual',
  cron: 'Scheduled',
  event: 'Event',
  call: 'Sub-workflow',
};

// ── Run groups ────────────────────────────────────────────────────────────────

const RUN_GROUPS = [
  {
    key: 'live' as const,
    label: 'Active & waiting',
    match: (s: string) => s === 'running' || s === 'waiting',
  },
  {
    key: 'recent' as const,
    label: 'Recent',
    match: (s: string) => s === 'succeeded' || s === 'failed' || s === 'cancelled',
  },
];

// ── Filter chips config ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'waiting' | 'running' | 'failed' | 'succeeded';

const FILTERS: Array<{ id: FilterKey; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'running', label: 'Running' },
  { id: 'failed', label: 'Failed' },
  { id: 'succeeded', label: 'Done' },
];

// ── Derived line text ─────────────────────────────────────────────────────────

function derivedLine(run: WorkflowRunSummary): string {
  if (run.status === 'waiting') return 'Waiting…';
  if (run.status === 'failed' && run.error) {
    // Truncate to a short single-line excerpt
    const head = run.error.split('\n')[0] ?? run.error;
    return head.length > 80 ? head.slice(0, 80) + '…' : head;
  }
  return '';
}

// ── WfRunRow ──────────────────────────────────────────────────────────────────

interface WfRunRowProps {
  run: WorkflowRunSummary;
  workflowName: string;
}

function WfRunRow({ run, workflowName }: WfRunRowProps): React.ReactElement {
  const { openRun } = useWorkflowsModal();
  // Cancelled maps to 'skipped' pip (same dashed-ring treatment as the prototype)
  const pipStatus = run.status === 'cancelled' ? 'skipped' : run.status;
  const triggerIcon = TRIGGER_ICON[run.triggerKind] ?? TRIGGER_ICON['manual'];
  const triggerLabel = TRIGGER_LABEL[run.triggerKind] ?? run.triggerKind;
  const line = derivedLine(run);

  return (
    <div
      data-testid={`workflows-run-row-${run.id}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        openRun(run.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openRun(run.id);
      }}
      className={cn(
        'flex items-center gap-3 px-[18px] py-[11px] cursor-pointer',
        'border-b border-border bg-transparent transition-colors',
        'hover:bg-accent',
      )}
    >
      <WfStatusPip status={pipStatus} />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top line: name, #id, child tag */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body font-semibold tracking-tight text-foreground">
            {workflowName}
          </span>
          <span className="shrink-0 font-mono text-micro text-mf-text-3">#{run.id}</span>
          {run.parentRunId !== null && (
            <span className="inline-flex shrink-0 items-center gap-[3px] text-micro text-mf-text-3">
              <Layers size={10} className="text-mf-text-4" aria-hidden />
              child
            </span>
          )}
        </div>

        {/* Sub-line: trigger icon + label + derived line */}
        <div className="mt-[3px] flex items-center gap-[10px] text-caption text-mf-text-3">
          <span className="inline-flex items-center gap-1">
            {triggerIcon}
            {triggerLabel}
          </span>
          {line && <span className="overflow-hidden text-ellipsis whitespace-nowrap">{line}</span>}
        </div>
      </div>

      {/* Ago timestamp */}
      <span className="shrink-0 whitespace-nowrap text-micro text-mf-text-3">{formatAgo(run.startedAt)}</span>

      {/* Status tag */}
      <WfStatusTag status={run.status} kind="run" />

      {/* Chevron */}
      <ChevronRight size={12} className="shrink-0 text-mf-text-4" aria-hidden />
    </div>
  );
}

// ── WfRunsList ────────────────────────────────────────────────────────────────

interface WfRunsListProps {
  port: number;
}

export function WfRunsList({ port: _port }: WfRunsListProps): React.ReactElement {
  const [filter, setFilter] = useState<FilterKey>('all');
  const runs = useWorkflowsStore((s) => s.runs);
  const workflows = useWorkflowsStore((s) => s.workflows);

  const shown = filter === 'all' ? runs : runs.filter((r) => r.status === filter);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Filter chips */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-[18px] py-[11px]">
        {FILTERS.map(({ id, label }) => {
          const on = filter === id;
          const count = id === 'all' ? runs.length : runs.filter((r) => r.status === id).length;
          return (
            <button
              key={id}
              data-testid={`workflows-runs-filter-${id}`}
              type="button"
              onClick={() => {
                setFilter(id);
              }}
              className={cn(
                'inline-flex h-[27px] items-center gap-1.5 rounded-full px-[11px]',
                'text-label cursor-pointer border-none',
                on
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'bg-muted font-medium text-muted-foreground hover:bg-accent',
              )}
            >
              {label}
              <span className="font-mono text-micro font-bold opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Grouped rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {RUN_GROUPS.map((group) => {
          const items = shown.filter((r) => group.match(r.status));
          if (items.length === 0) return null;
          return (
            <section key={group.key}>
              <div className="sticky top-0 z-[1] border-b border-border bg-mf-content2 px-[18px] py-[7px] text-micro font-bold uppercase tracking-[0.6px] text-mf-text-3">
                {group.label}
              </div>
              {items.map((run) => {
                const wfName = workflows.find((w) => w.id === run.workflowId)?.name ?? run.workflowId;
                return <WfRunRow key={run.id} run={run} workflowName={wfName} />;
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
