/**
 * WfInteractionCard — a single pending workflow interaction, collapsible.
 *
 * Header: title + optional expiry chip (red when <2h, amber otherwise).
 * Sub-line: workflow name (looked up by run → workflow), run id, "waiting" age.
 * Prompt: the human-readable question text below the sub-line.
 * Body (expanded): WfAnswerForm.
 * Actions: Answer/Collapse toggle + View run.
 *
 * Spacing note: all layout values use arbitrary [Npx] classes to be immune
 * to the compressed integer-spacing override in globals.css.
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
    : 'text-amber-600 bg-amber-500/10';
}

/**
 * Formats a future Unix timestamp (ms) as a human-readable "in X" string.
 * Used for expiry chips — timestamps are in the future, not the past.
 */
function formatIn(ts: number): string {
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return 'expiring';
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHr < 24) return remMin > 0 ? `in ${diffHr}h ${remMin}m` : `in ${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `in ${diffDay}d`;
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
    <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card shadow-sm">
      <div className="flex items-start gap-[12px] px-[16px] py-[14px]">
        {/* Icon disc */}
        <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-amber-500/13">
          <MessageSquare size={17} className="text-amber-600" aria-hidden />
        </span>

        {/* Body */}
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-bold tracking-tight text-foreground">{interaction.title}</span>
            {expiresAt != null && (
              <span
                className={cn(
                  'inline-flex h-[19px] items-center gap-[4px] rounded-full px-[8px] text-micro font-bold',
                  expiryChipClass(expiresAt),
                )}
              >
                <Clock size={10} aria-hidden />
                expires {formatIn(expiresAt)}
              </span>
            )}
          </div>

          {/* Sub-line */}
          <div className="mt-[3px] flex items-center gap-2 text-caption text-muted-foreground">
            <span className="font-semibold text-foreground/70">{workflowName}</span>
            <span>· run #{interaction.runId}</span>
            <span>· waiting {formatAgo(createdAt)}</span>
          </div>

          {/* Prompt — the human-readable question text */}
          {interaction.prompt != null && (
            <div className="mt-[7px] text-label leading-[1.5] text-foreground/70">{interaction.prompt}</div>
          )}

          {/* Expanded form */}
          {open && (
            <div className="mt-[13px]">
              <WfAnswerForm port={port} interaction={interaction} onDone={() => setOpen(false)} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-col gap-[6px]">
          {open ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-[32px] items-center px-[13px] rounded-md border-[0.5px] border-border bg-card text-label font-medium text-foreground/70"
            >
              Collapse
            </button>
          ) : (
            <button
              type="button"
              data-testid={`workflows-interaction-answer-${interaction.id}`}
              onClick={() => setOpen(true)}
              className="inline-flex h-[32px] items-center gap-[6px] rounded-md bg-primary px-[14px] text-label font-semibold text-white"
            >
              <CornerDownLeft size={12} aria-hidden />
              Answer
            </button>
          )}
          <button
            type="button"
            data-testid={`workflows-interaction-viewrun-${interaction.id}`}
            onClick={() => openRun(interaction.runId)}
            className="inline-flex h-[30px] items-center justify-center gap-[5px] rounded-md border-[0.5px] border-border bg-transparent px-[11px] text-caption font-medium text-foreground/70"
          >
            View run
          </button>
        </div>
      </div>
    </div>
  );
}
