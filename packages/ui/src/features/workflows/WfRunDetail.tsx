/**
 * WfRunDetail — master-detail view for a single workflow run.
 *
 * Header: back button, workflow name + run id + status tag in the title row,
 * Cancel button in the title row (running/waiting only — 0.5px red border,
 * stop-square glyph), trigger/timing/parent line, status-tinted banner
 * (shown when run.banner is set, keyed to run status — not just waiting).
 *
 * Body: the run's step tree via WfTree (rail-only, v1).
 *
 * Footer: produced outputs (key/value rows) when run.outputs is set,
 * prefixed with a green CircleDot icon and "returned to…" subtitle.
 *
 * onOpenChat wiring: calls openSessionById from lib/session-nav (the
 * module-level seam registered by AppShell) then closes the workflows modal.
 */
import React from 'react';
import { ChevronLeft, Square, Play, Calendar, Zap, Layers, Clock, CircleDot } from 'lucide-react';
import type { WorkflowRunSummary } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsModal } from './use-workflows-modal';
import { WfStatusTag, WfStatusPip } from './WfStatus';
import { getRunStatusMeta, formatAgo } from './glyphs';
import { WfTree } from './WfTree';
import * as wfApi from '@/lib/api/workflows';
import { openSessionById } from '@/lib/session-nav';

// ── Helpers ───────────────────────────────────────────────────────────────────

// A run's triggerKind is the mechanism that started it (engine emits these),
// distinct from a workflow's definition triggers (manual|schedule|event|webhook).
const TRIGGER_ICON: Record<WorkflowRunSummary['triggerKind'], React.ReactElement> = {
  manual: <Play size={11} fill="currentColor" aria-hidden />,
  cron: <Calendar size={11} aria-hidden />,
  event: <Zap size={11} aria-hidden />,
  call: <Layers size={11} aria-hidden />,
};

const TRIGGER_LABEL: Record<WorkflowRunSummary['triggerKind'], string> = {
  manual: 'Manual',
  cron: 'Scheduled',
  event: 'Event',
  call: 'Sub-workflow',
};

/**
 * Maps a run status tone to the banner background + border classes.
 * Prototype: `rgba(color, 0.09)` bg + `rgba(color, 0.22)` inset ring.
 * We replicate via Tailwind tint tokens where they exist, arbitrary otherwise.
 */
function bannerTintClasses(tone: string): string {
  switch (tone) {
    case 'primary':
      return 'bg-primary/10 ring-primary/20';
    case 'warning':
      return 'bg-mf-warning-tint ring-mf-warning/25';
    case 'success':
      return 'bg-mf-success-tint ring-mf-success/25';
    case 'destructive':
      return 'bg-mf-destructive-tint ring-destructive/25';
    default:
      return 'bg-muted ring-border';
  }
}

function isActive(status: string): boolean {
  return status === 'running' || status === 'waiting';
}

// ── WfRunDetail ───────────────────────────────────────────────────────────────

interface WfRunDetailProps {
  port: number;
}

export function WfRunDetail({ port }: WfRunDetailProps): React.ReactElement | null {
  const runDetail = useWorkflowsStore((s) => s.runDetail);
  const workflows = useWorkflowsStore((s) => s.workflows);
  const { backToList, setSection, close, openRun } = useWorkflowsModal();

  if (!runDetail) return null;

  const { run, tree } = runDetail;
  const workflowName = workflows.find((w) => w.id === run.workflowId)?.name ?? run.workflowId;
  const triggerIcon = TRIGGER_ICON[run.triggerKind] ?? TRIGGER_ICON['manual'];
  const triggerLabel = TRIGGER_LABEL[run.triggerKind] ?? run.triggerKind;

  const statusMeta = getRunStatusMeta(run.status);

  const outputs = run.outputs as Record<string, unknown> | null | undefined;
  const outputEntries = outputs != null && typeof outputs === 'object' ? Object.entries(outputs) : null;

  // Banner: daemon-supplied narrative shown for any run status.
  const banner: string | null = run.banner ?? null;
  const bannerCta = run.bannerCta ?? null;

  function handleCancel(): void {
    wfApi.cancelRun(port, run.id).catch((err: unknown) => {
      console.warn('[WfRunDetail] cancelRun failed', err);
    });
  }

  function handleOpenChat(chatId: string): void {
    openSessionById(chatId);
    close();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-col border-b border-border px-[18px] pb-[13px] pt-[14px]">
        {/* Back row */}
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            data-testid="workflows-run-back"
            onClick={backToList}
            className={cn(
              'inline-flex items-center justify-center rounded-md h-[30px] w-[30px]',
              'text-mf-text-3 hover:bg-accent transition-colors',
            )}
            title="Back to runs"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>

          {/* Title + #id + status tag + Cancel (all in one row, prototype layout) */}
          <div className="flex min-w-0 flex-1 items-center gap-[9px]">
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-title font-bold tracking-tight text-foreground">
              {workflowName}
            </span>
            <span className="shrink-0 font-mono text-caption text-mf-text-3">#{run.id}</span>
            <WfStatusTag status={run.status} kind="run" />
          </div>

          {/* Cancel button — in the title row, 0.5px red border, stop-square glyph */}
          {isActive(run.status) && (
            <button
              type="button"
              data-testid="workflows-run-cancel"
              onClick={handleCancel}
              className={cn(
                'shrink-0 inline-flex items-center gap-[6px] h-[30px] px-[12px]',
                'rounded-md border-[0.5px] border-destructive/40 bg-transparent cursor-pointer',
                'text-destructive text-label font-semibold',
                'hover:bg-destructive/10 transition-colors',
              )}
            >
              <Square size={11} fill="currentColor" aria-hidden />
              Cancel
            </button>
          )}
        </div>

        {/* Trigger / timing / parent line */}
        <div className="mt-[5px] flex flex-wrap items-center gap-[14px] text-caption text-mf-text-3">
          <span className="inline-flex items-center gap-[5px]">
            {triggerIcon}
            {triggerLabel}
          </span>
          <span className="inline-flex items-center gap-[5px]">
            <Clock size={11} aria-hidden />
            {formatAgo(run.startedAt)}
          </span>
          {run.parentRunId != null && (
            <button
              type="button"
              data-testid="workflows-run-parent-link"
              onClick={() => openRun(String(run.parentRunId))}
              className="inline-flex cursor-pointer items-center gap-[5px] text-primary"
            >
              <Layers size={11} aria-hidden />
              Parent: #{run.parentRunId}
            </button>
          )}
        </div>

        {/* Status-tinted banner — shown for any status when run.banner is set */}
        {banner != null && (
          <div
            data-testid="workflows-run-banner"
            className={cn(
              'mt-[11px] flex items-center gap-[9px] rounded-md px-[12px] py-[9px]',
              'ring-1 ring-inset',
              bannerTintClasses(statusMeta.tone),
            )}
          >
            <WfStatusPip status={run.status} size={14} />
            <span className="flex-1 text-label font-medium text-foreground">{banner}</span>
            {bannerCta != null && (
              <button
                type="button"
                data-testid="workflows-run-banner-cta"
                onClick={() => {
                  if (bannerCta.action === 'answer') setSection('needs');
                }}
                className={cn(
                  'shrink-0 inline-flex items-center gap-[5px] h-[28px] px-[12px]',
                  'rounded-md border-none cursor-pointer',
                  'bg-mf-warning text-white text-caption font-bold',
                  'hover:opacity-90 transition-opacity',
                )}
              >
                {bannerCta.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tree scroll area — prototype padding: 14px 16px 24px ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] pt-[14px] pb-[24px]">
        <WfTree nodes={tree} onOpenChat={handleOpenChat} />
      </div>

      {/* ── Produced-outputs footer ── */}
      {outputEntries != null && outputEntries.length > 0 && (
        <div className="shrink-0 border-t border-border bg-mf-content2 px-[18px] pb-[13px] pt-[11px]">
          {/* Header row: green CircleDot + title + "returned to…" subtitle */}
          <div className="mb-[8px] flex items-center gap-[7px]">
            <CircleDot size={12} className="shrink-0 text-mf-success" aria-hidden />
            <span className="text-micro font-bold uppercase tracking-wide text-mf-text-3">Produced outputs</span>
            <span className="text-micro text-mf-text-3">returned to whatever called this run</span>
          </div>
          {/* Key/value rows */}
          <div className="flex flex-col gap-[5px]">
            {outputEntries.map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-[8px] font-mono text-caption">
                <span className="w-[92px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold text-mf-text-3">
                  {key}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
                  {JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
