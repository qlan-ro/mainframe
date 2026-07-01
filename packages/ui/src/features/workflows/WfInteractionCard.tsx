/**
 * WfInteractionCard — a single pending workflow interaction, collapsible.
 *
 * Header: title + optional expiry chip (red when <2h, amber otherwise).
 * Sub-line: workflow name (looked up by run → workflow), run id, "waited" age.
 * Body (expanded): WfAnswerForm.
 * Actions: Answer/Collapse toggle + View run.
 */
import React, { useState } from 'react';
import { Clock, MessageSquare, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsModal } from './use-workflows-modal';
import { WfAnswerForm } from './WfAnswerForm';
import { formatAgo } from './glyphs';
import type { WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function expiryChipClass(expiresAt: number): string {
  return Date.now() >= expiresAt - TWO_HOURS_MS
    ? 'text-destructive bg-destructive/10'
    : 'text-mf-warning bg-mf-warning/10';
}

function useWorkflowName(runId: string): string {
  const runs = useWorkflowsStore((s) => s.runs);
  const workflows = useWorkflowsStore((s) => s.workflows);
  const run = runs.find((r) => r.id === runId);
  if (!run) return `#${runId}`;
  const wf = workflows.find((w) => w.id === run.workflowId);
  return wf?.name ?? `#${runId}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface WfInteractionCardProps {
  port: number;
  interaction: WorkflowInteractionSummary;
  defaultExpanded?: boolean;
}

export function WfInteractionCard({
  port,
  interaction,
  defaultExpanded = false,
}: WfInteractionCardProps): React.ReactElement {
  const [open, setOpen] = useState(defaultExpanded);
  const { openRun } = useWorkflowsModal();
  const workflowName = useWorkflowName(interaction.runId);
  const { expiresAt, createdAt } = interaction;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Icon disc */}
        <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-mf-warning/13">
          <MessageSquare size={17} className="text-mf-warning" aria-hidden />
        </span>

        {/* Body */}
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-bold tracking-tight text-foreground">{interaction.title}</span>
            {expiresAt != null && (
              <span
                className={cn(
                  'inline-flex h-[19px] items-center gap-1 rounded-full px-2 text-micro font-bold',
                  expiryChipClass(expiresAt),
                )}
              >
                <Clock size={10} aria-hidden />
                {formatAgo(expiresAt)}
              </span>
            )}
          </div>

          {/* Sub-line */}
          <div className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="font-semibold text-foreground/70">{workflowName}</span>
            <span>· run #{interaction.runId}</span>
            <span>· waited {formatAgo(createdAt)}</span>
          </div>

          {/* Expanded form */}
          {open && (
            <div className="mt-3">
              <WfAnswerForm port={port} interaction={interaction} onDone={() => setOpen(false)} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-col gap-1.5">
          {open ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center px-3.5 rounded-md border border-border bg-card text-label font-medium text-foreground/70"
            >
              Collapse
            </button>
          ) : (
            <button
              type="button"
              data-testid={`workflows-interaction-answer-${interaction.id}`}
              onClick={() => setOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-label font-semibold text-white"
            >
              <CornerDownLeft size={12} aria-hidden />
              Answer
            </button>
          )}
          <button
            type="button"
            data-testid={`workflows-interaction-viewrun-${interaction.id}`}
            onClick={() => openRun(interaction.runId)}
            className="inline-flex h-[30px] items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-caption font-medium text-foreground/70"
          >
            View run
          </button>
        </div>
      </div>
    </div>
  );
}
