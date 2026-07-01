/**
 * WfTree — vertical rail spine rendering the run's step tree.
 *
 * Leaf steps render as WfStepNode. Composite nodes (parallel, choose,
 * foreach, call/subflow) wrap their children in framed containers.
 *
 * v1 is Rail-only — no Rail/Blocks toggle.
 *
 * Ported from the design prototype's WfCompositeRail / WfLoopRail /
 * WfBranchRail (18-workflows.jsx), translating tokens and icons.
 */
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WfStepNode } from './WfStepNode';
import { WfStatusPip, WfStatusTag } from './WfStatus';
import { useWorkflowsModal } from './use-workflows-modal';
import type { RunTreeNode } from '@/lib/api/workflows';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WfTreeProps {
  nodes: RunTreeNode[];
  onOpenChat: (chatId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the index of the first running/waiting iteration;
 * falls back to 0 if none match.
 */
function defaultIterIdx(iterations: Array<{ status: string }>): number {
  const idx = iterations.findIndex((it) => it.status === 'running' || it.status === 'waiting');
  return idx >= 0 ? idx : 0;
}

// ── Composite: Parallel lanes ─────────────────────────────────────────────────

interface WfParallelRailProps {
  node: RunTreeNode;
  onOpenChat: (chatId: string) => void;
}

function WfParallelRail({ node, onOpenChat }: WfParallelRailProps): React.ReactElement {
  const lanes = node.lanes ?? [];

  return (
    <div className="flex flex-col gap-1 border-l-2 border-primary/20 pl-3 my-1">
      {/* parallel label row */}
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <WfStatusPip status={node.status} size={14} />
        <span className="text-label font-semibold text-mf-text-3 uppercase tracking-wide">
          Parallel — {lanes.length} lanes
        </span>
      </div>

      {/* Lane cards side-by-side */}
      <div className="flex flex-row gap-2 overflow-x-auto pb-1">
        {lanes.map((lane, i) => (
          <div key={i} className={cn('flex min-w-[220px] flex-1 flex-col rounded-md border border-border bg-card')}>
            {/* Lane header */}
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
              <WfStatusPip status={lane.status} size={14} />
              <span className="flex-1 text-label font-semibold text-foreground">{lane.label}</span>
              <WfStatusTag status={lane.status} kind="step" />
            </div>
            {/* Lane steps */}
            <div className="flex flex-col">
              <WfTree nodes={lane.steps} onOpenChat={onOpenChat} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Composite: Choose (branch) arms ───────────────────────────────────────────

interface WfBranchRailProps {
  node: RunTreeNode;
  onOpenChat: (chatId: string) => void;
}

function WfBranchRail({ node, onOpenChat }: WfBranchRailProps): React.ReactElement {
  const arms = node.arms ?? [];

  return (
    <div className="flex flex-col gap-1 border-l-2 border-violet-400/30 pl-3 my-1">
      {/* choose label */}
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <WfStatusPip status={node.status} size={14} />
        <span className="text-label font-semibold text-mf-text-3 uppercase tracking-wide">Branch</span>
      </div>

      {/* Arms stacked */}
      {arms.map((arm, i) => (
        <div
          key={i}
          className={cn(
            'flex flex-col rounded-md border border-border',
            arm.taken ? 'bg-card' : 'bg-mf-content2 opacity-60',
          )}
        >
          {/* Arm header: condition + optional Skipped tag */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <code className="font-mono text-caption text-foreground">{arm.cond}</code>
            {!arm.taken && (
              <span className="ml-auto">
                <WfStatusTag status="skipped" kind="step" />
              </span>
            )}
          </div>

          {/* Steps — only rendered for the taken arm */}
          {arm.taken && arm.steps.length > 0 && (
            <div className="flex flex-col">
              <WfTree nodes={arm.steps} onOpenChat={onOpenChat} />
            </div>
          )}

          {/* Untaken arm: dimmed placeholder */}
          {!arm.taken && <div className="px-3 py-2 text-caption text-mf-text-4 italic">Not taken</div>}
        </div>
      ))}
    </div>
  );
}

// ── Composite: Foreach (loop) iterations ──────────────────────────────────────

interface WfLoopRailProps {
  node: RunTreeNode;
  onOpenChat: (chatId: string) => void;
}

function WfLoopRail({ node, onOpenChat }: WfLoopRailProps): React.ReactElement {
  const iterations = node.iterations ?? [];
  const [selectedIdx, setSelectedIdx] = useState(() => defaultIterIdx(iterations));
  const current = iterations[selectedIdx];

  return (
    <div className="flex flex-col gap-1 border-l-2 border-emerald-400/30 pl-3 my-1">
      {/* foreach label */}
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <WfStatusPip status={node.status} size={14} />
        <span className="text-label font-semibold text-mf-text-3 uppercase tracking-wide">
          Loop — {iterations.length} iterations
        </span>
      </div>

      {/* Iteration switcher tabs */}
      <div className="flex flex-row flex-wrap gap-1 px-1">
        {iterations.map((iter, i) => (
          <button
            key={i}
            type="button"
            data-testid={`workflows-iter-${i}`}
            onClick={() => {
              setSelectedIdx(i);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label font-medium transition-colors',
              selectedIdx === i
                ? 'bg-primary/10 text-primary font-semibold'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            <WfStatusPip status={iter.status} size={14} />
            {iter.label}
          </button>
        ))}
      </div>

      {/* Selected iteration's steps */}
      {current !== undefined && current.steps.length > 0 && (
        <div className="flex flex-col rounded-md border border-border bg-card mt-1">
          <WfTree nodes={current.steps} onOpenChat={onOpenChat} />
        </div>
      )}
    </div>
  );
}

// ── Composite: Call / subflow ─────────────────────────────────────────────────

interface WfCallRailProps {
  node: RunTreeNode;
  onOpenChat: (chatId: string) => void;
}

function WfCallRail({ node, onOpenChat }: WfCallRailProps): React.ReactElement {
  const { openRun } = useWorkflowsModal();

  return (
    <div className="flex flex-col gap-1 border-l-2 border-blue-400/30 pl-3 my-1">
      {/* subflow header */}
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <WfStatusPip status={node.status} size={14} />
        <span className="text-label font-semibold text-mf-text-3 uppercase tracking-wide">
          Sub-workflow: {node.ref ?? 'call'}
        </span>
        {node.childRunId && (
          <button
            type="button"
            data-testid={`workflows-subflow-${node.stepPath}`}
            onClick={() => {
              if (node.childRunId) openRun(node.childRunId);
            }}
            className="ml-auto inline-flex items-center gap-1 text-caption text-primary hover:underline"
          >
            <ExternalLink size={11} aria-hidden />
            Open run
          </button>
        )}
      </div>

      {/* Child steps */}
      {(node.steps ?? []).length > 0 && (
        <div className="flex flex-col rounded-md border border-border bg-card mt-1">
          <WfTree nodes={node.steps ?? []} onOpenChat={onOpenChat} />
        </div>
      )}
    </div>
  );
}

// ── WfTree ────────────────────────────────────────────────────────────────────

/**
 * Renders a list of RunTreeNodes as a vertical rail.
 * Each composite node delegates to the appropriate Composite component.
 * Leaf nodes render as WfStepNode.
 */
export function WfTree({ nodes, onOpenChat }: WfTreeProps): React.ReactElement {
  return (
    <div className="flex flex-col">
      {nodes.map((node) => {
        // Parallel composite
        if (node.lanes != null && node.lanes.length > 0) {
          return <WfParallelRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
        }

        // Choose composite
        if (node.arms != null && node.arms.length > 0) {
          return <WfBranchRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
        }

        // Foreach composite
        if (node.iterations != null && node.iterations.length > 0) {
          return <WfLoopRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
        }

        // Call / subflow composite
        if (node.ref != null || node.childRunId != null) {
          return <WfCallRail key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
        }

        // Leaf step
        return <WfStepNode key={node.stepPath} node={node} onOpenChat={onOpenChat} />;
      })}
    </div>
  );
}
