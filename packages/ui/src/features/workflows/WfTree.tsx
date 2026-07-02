/**
 * WfTree — the run-detail rail timeline.
 *
 * A single vertical spine (WfSpine, left:13) runs through the tree. Leaves render
 * as WfStepNode (on-spine status pip). Composites (parallel, choose, foreach,
 * call) render a shared WfCompositeHead + on-spine kind pip and INDENT children
 * by marginLeft:30 — the prototype's lane / iteration / branch-arm treatment.
 * No border-l-2 bars (removed in the rail rebuild). Rebuilt from the prototype's
 * WfCompositeRail / WfLoopRail / WfBranchRail (18-workflows.jsx); explicit pixels
 * use arbitrary `[Npx]` classes (integer Tailwind steps render compressed here).
 */
import React, { useState } from 'react';
import { ChevronRight, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WfStepNode } from './WfStepNode';
import { WfStatusPip, WfStatusTag, WfKindChip } from './WfStatus';
import { getKindMeta } from './glyphs';
import { useWorkflowsModal } from './use-workflows-modal';
import type { RunTreeNode } from '@/lib/api/workflows';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WfTreeProps {
  nodes: RunTreeNode[];
  onOpenChat: (chatId: string) => void;
}

interface CompositeProps {
  node: RunTreeNode;
  onOpenChat: (chatId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultIterIdx(iterations: Array<{ status: string }>): number {
  const idx = iterations.findIndex((it) => it.status === 'running' || it.status === 'waiting');
  return idx >= 0 ? idx : 0;
}

/** Maps an iteration's own status to the active-chip border/bg classes. */
function activeIterChipClasses(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'border-mf-success/60 bg-mf-success/10';
    case 'running':
      return 'border-primary/60 bg-primary/10';
    case 'waiting':
    case 'ambiguous':
      return 'border-mf-warning/60 bg-mf-warning/10';
    case 'failed':
      return 'border-destructive/60 bg-destructive/10';
    default:
      return 'border-border bg-muted';
  }
}

// ── Spine ──────────────────────────────────────────────────────────────────────

/** The vertical rail line, positioned at left:13 behind the pips. */
function WfSpine({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="relative">
      <div className="absolute left-[13px] top-[10px] bottom-[10px] w-0.5 bg-border" aria-hidden />
      {children}
    </div>
  );
}

// ── Composite head + shell (shared) ────────────────────────────────────────────

interface WfCompositeHeadProps {
  node: RunTreeNode;
  summary: string;
  right?: React.ReactNode;
}

function WfCompositeHead({ node, summary, right }: WfCompositeHeadProps): React.ReactElement {
  const title = node.stepId ?? getKindMeta(node.kind).label;
  return (
    <div className="flex min-w-0 items-center gap-[9px]">
      <WfKindChip kind={node.kind} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-body font-bold tracking-[-0.1px] text-foreground">
        {title}
      </span>
      {summary && <span className="whitespace-nowrap text-caption text-mf-text-3">{summary}</span>}
      <span className="flex-1" />
      {right}
    </div>
  );
}

/**
 * Shared composite frame: an on-spine kind pip (a tinted circle with the kind
 * icon at left:6/top:11), the indented (ml:30) head, then the body.
 */
function WfCompositeShell({
  node,
  summary,
  right,
  children,
}: {
  node: RunTreeNode;
  summary: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const kindMeta = getKindMeta(node.kind);
  const { Icon } = kindMeta;
  return (
    <div className="relative mb-0.5">
      <div className="absolute left-[6px] top-[11px]">
        <span
          className={cn(
            'inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-current/[0.18]',
            kindMeta.colorClass,
          )}
        >
          <Icon size={10} className={kindMeta.colorClass} aria-hidden />
        </span>
      </div>
      <div className="ml-[30px]">
        <div className="px-[4px] pb-[9px] pt-[7px]">
          <WfCompositeHead node={node} summary={summary} right={right} />
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Composite: Parallel lanes ──────────────────────────────────────────────────

function WfParallelRail({ node, onOpenChat }: CompositeProps): React.ReactElement {
  const lanes = node.lanes ?? [];
  return (
    <WfCompositeShell node={node} summary={node.summary ?? ''}>
      <div className="flex flex-wrap gap-[10px]">
        {lanes.map((lane) => (
          <div
            key={lane.label}
            className="min-w-[200px] flex-[1_1_220px] overflow-hidden rounded-lg border-[0.5px] border-border bg-mf-content2"
          >
            <div className="flex items-center gap-[7px] border-b-[0.5px] border-border px-[10px] py-[7px]">
              <WfStatusPip status={lane.status} size={14} />
              <span className="flex-1 text-caption font-bold text-foreground">{lane.label}</span>
              <WfStatusTag status={lane.status} kind="step" />
            </div>
            <div className="py-[6px] pr-[4px]">
              <WfTree nodes={lane.steps} onOpenChat={onOpenChat} />
            </div>
          </div>
        ))}
      </div>
    </WfCompositeShell>
  );
}

// ── Composite: Choose (branch) arms ────────────────────────────────────────────

function WfBranchRail({ node, onOpenChat }: CompositeProps): React.ReactElement {
  const arms = node.arms ?? [];
  const kindMeta = getKindMeta(node.kind);
  return (
    <WfCompositeShell node={node} summary={node.summary ?? ''}>
      <div className="flex flex-col gap-[7px]">
        {arms.map((arm, i) => (
          <div
            key={`${node.stepPath}.arm${i}`}
            className={cn(
              'overflow-hidden rounded-lg border-[0.5px]',
              arm.taken ? 'border-mf-accent-violet/40 bg-mf-content2' : 'border-border opacity-60',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-[8px] px-[11px] py-[7px]',
                arm.taken && 'border-b-[0.5px] border-border',
              )}
            >
              {arm.taken ? (
                <ChevronRight size={12} className={kindMeta.colorClass} aria-hidden />
              ) : (
                <CircleDashed size={12} className="text-mf-text-4" aria-hidden />
              )}
              <code
                className={cn('font-mono text-caption font-semibold', arm.taken ? 'text-foreground' : 'text-mf-text-3')}
              >
                {arm.cond}
              </code>
              <span className="flex-1" />
              {arm.taken ? (
                <span className="text-micro font-bold uppercase tracking-wide text-mf-accent-violet">Taken</span>
              ) : (
                <WfStatusTag status="skipped" kind="step" />
              )}
            </div>
            {arm.taken && arm.steps.length > 0 && (
              <div className="py-[6px] pr-[4px]">
                <WfTree nodes={arm.steps} onOpenChat={onOpenChat} />
              </div>
            )}
          </div>
        ))}
      </div>
    </WfCompositeShell>
  );
}

// ── Composite: Foreach (loop) iterations ───────────────────────────────────────

function WfLoopRail({ node, onOpenChat }: CompositeProps): React.ReactElement {
  const iterations = node.iterations ?? [];
  const [selectedIdx, setSelectedIdx] = useState(() => defaultIterIdx(iterations));
  const current = iterations[selectedIdx];
  return (
    <WfCompositeShell node={node} summary={node.summary ?? ''}>
      {/* Iteration switcher */}
      <div className="mb-[8px] flex flex-wrap items-center gap-[5px]">
        {iterations.map((iter, i) => {
          const on = i === selectedIdx;
          return (
            <button
              key={iter.label}
              type="button"
              data-testid={`workflows-iter-${iter.label}`}
              title={iter.label}
              onClick={() => setSelectedIdx(i)}
              className={cn(
                'inline-flex h-[24px] items-center gap-[5px] rounded-sm px-[9px] text-caption transition-colors',
                on
                  ? cn('border font-bold text-foreground', activeIterChipClasses(iter.status))
                  : 'border-[0.5px] border-border bg-card font-medium text-muted-foreground hover:bg-accent',
              )}
            >
              <WfIterDot status={iter.status} />
              {iter.label}
            </button>
          );
        })}
      </div>
      {current !== undefined && current.steps.length > 0 && (
        <div className="rounded-lg border-[0.5px] border-border bg-mf-content2 py-[6px] pr-[4px]">
          <WfTree nodes={current.steps} onOpenChat={onOpenChat} />
        </div>
      )}
    </WfCompositeShell>
  );
}

/** Small solid status dot for iteration chips (prototype 7px). */
function WfIterDot({ status }: { status: string }): React.ReactElement {
  const map: Record<string, string> = {
    succeeded: 'bg-mf-success',
    running: 'bg-primary',
    waiting: 'bg-mf-warning',
    failed: 'bg-destructive',
    ambiguous: 'bg-mf-warning',
  };
  return <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', map[status] ?? 'bg-mf-text-4')} aria-hidden />;
}

// ── Composite: Call / subflow ──────────────────────────────────────────────────

function WfCallRail({ node, onOpenChat }: CompositeProps): React.ReactElement {
  const { openRun } = useWorkflowsModal();
  const steps = node.steps ?? [];
  const right = node.childRunId ? (
    <button
      type="button"
      data-testid={`workflows-subflow-${node.stepPath}`}
      onClick={() => {
        if (node.childRunId) openRun(node.childRunId);
      }}
      className="inline-flex h-[24px] items-center gap-[5px] rounded-sm border-[0.5px] border-border bg-card px-[9px] text-caption font-semibold text-primary hover:bg-accent"
    >
      {node.ref ?? 'Open run'}
      <ChevronRight size={9} aria-hidden />
    </button>
  ) : undefined;

  return (
    <WfCompositeShell node={node} summary={node.summary ?? (node.ref ? '' : 'sub-workflow')} right={right}>
      {steps.length > 0 && (
        <div className="ml-px border-l-2 border-[#2a6fdb]/30 pl-[6px]">
          <WfTree nodes={steps} onOpenChat={onOpenChat} />
        </div>
      )}
    </WfCompositeShell>
  );
}

// ── WfTree ────────────────────────────────────────────────────────────────────

function renderNode(node: RunTreeNode, onOpenChat: (chatId: string) => void): React.ReactElement {
  if (node.lanes != null && node.lanes.length > 0) {
    return <WfParallelRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
  }
  if (node.arms != null && node.arms.length > 0) {
    return <WfBranchRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
  }
  if (node.iterations != null && node.iterations.length > 0) {
    return <WfLoopRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
  }
  if (node.ref != null || node.childRunId != null) {
    return <WfCallRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
  }
  return <WfStepNode key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
}

/**
 * Renders a list of RunTreeNodes as a vertical rail through a shared spine.
 * Composite nodes delegate to their rail renderer; leaves render as WfStepNode.
 */
export function WfTree({ nodes, onOpenChat }: WfTreeProps): React.ReactElement {
  return <WfSpine>{nodes.map((node) => renderNode(node, onOpenChat))}</WfSpine>;
}
