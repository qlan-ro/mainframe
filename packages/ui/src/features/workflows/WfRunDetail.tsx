/**
 * WfRunDetail — master-detail view for a single workflow run.
 *
 * Header: back button, workflow name + run id + status tag,
 * trigger/timing line, optional cancel button (running/waiting only),
 * optional waiting banner with "Answer now" CTA when there are pending
 * interactions for this run.
 *
 * Body: the run's step tree via WfTree (rail-only, v1).
 *
 * Footer: produced outputs (key/value rows) when run.outputs is set.
 *
 * onOpenChat wiring: calls openSessionById from lib/session-nav (the
 * module-level seam registered by AppShell) then closes the workflows modal.
 * TODO: confirm chat-open wiring — dispatches via openSessionById which
 * resolves to runtime.threads.switchToThread registered in AppShell.
 */
import React from 'react';
import { ArrowLeft, X, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from './use-workflows-store';
import { useWorkflowsModal } from './use-workflows-modal';
import { WfStatusTag } from './WfStatus';
import { formatAgo } from './glyphs';
import { WfTree } from './WfTree';
import * as wfApi from '@/lib/api/workflows';
import { openSessionById } from '@/lib/session-nav';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  cron: 'Schedule',
  event: 'Event',
  call: 'Sub-workflow',
};

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
  const interactions = useWorkflowsStore((s) => s.interactions);
  const { backToList, setSection, close } = useWorkflowsModal();

  if (!runDetail) return null;

  const { run, tree } = runDetail;
  const workflowName = workflows.find((w) => w.id === run.workflowId)?.name ?? run.workflowId;
  const triggerLabel = TRIGGER_LABEL[run.triggerKind] ?? run.triggerKind;

  // A run has pending interactions when there is at least one interaction
  // stored in the global interactions list (store tracks unresolved ones).
  const hasPendingInteraction = interactions.length > 0;

  const outputs = run.outputs as Record<string, unknown> | null | undefined;
  const outputEntries = outputs != null && typeof outputs === 'object' ? Object.entries(outputs) : null;

  function handleCancel(): void {
    wfApi.cancelRun(port, run.id).catch((err: unknown) => {
      console.warn('[WfRunDetail] cancelRun failed', err);
    });
  }

  function handleOpenChat(chatId: string): void {
    // TODO: confirm chat-open wiring
    openSessionById(chatId);
    close();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-[18px] py-3">
        {/* Back row */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="workflows-run-back"
            onClick={backToList}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1',
              'text-label font-medium text-muted-foreground hover:bg-accent transition-colors',
            )}
          >
            <ArrowLeft size={13} aria-hidden />
            Back
          </button>
        </div>

        {/* Title row: workflow name, #id, status tag */}
        <div className="flex items-center gap-2">
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-heading font-bold tracking-tight text-foreground">
            {workflowName}
          </span>
          <span className="shrink-0 font-mono text-caption text-mf-text-3">#{run.id}</span>
          <WfStatusTag status={run.status} kind="run" />
        </div>

        {/* Trigger / timing line */}
        <div className="flex items-center gap-2 text-caption text-mf-text-3">
          <span>{triggerLabel}</span>
          <span>·</span>
          <span>{formatAgo(run.startedAt)}</span>
          {run.parentRunId != null && (
            <>
              <span>·</span>
              <span>child of #{run.parentRunId}</span>
            </>
          )}
        </div>

        {/* Cancel button — only for active runs */}
        {isActive(run.status) && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="workflows-run-cancel"
              onClick={handleCancel}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5',
                'text-label font-medium text-destructive hover:bg-destructive/10 transition-colors',
              )}
            >
              <X size={13} aria-hidden />
              Cancel run
            </button>
          </div>
        )}

        {/* Waiting banner with "Answer now" CTA */}
        {run.status === 'waiting' && hasPendingInteraction && (
          <div className={cn('flex items-center gap-3 rounded-md px-3 py-2.5', 'bg-mf-warning-tint text-mf-warning')}>
            <Bell size={15} className="shrink-0" aria-hidden />
            <span className="flex-1 text-caption">This run is waiting for your input.</span>
            <button
              type="button"
              onClick={() => {
                setSection('needs');
              }}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-label font-semibold',
                'bg-mf-warning text-white hover:opacity-90 transition-opacity',
              )}
            >
              Answer now
            </button>
          </div>
        )}
      </div>

      {/* ── Tree scroll area ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WfTree nodes={tree} onOpenChat={handleOpenChat} />
      </div>

      {/* ── Produced-outputs footer ── */}
      {outputEntries != null && outputEntries.length > 0 && (
        <div className="shrink-0 border-t border-border px-[18px] py-3">
          <div className="mb-2 text-micro font-bold uppercase tracking-wider text-mf-text-3">Produced outputs</div>
          <div className="flex flex-col gap-1.5">
            {outputEntries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-caption">
                <span className="w-[120px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground">
                  {key}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-mf-text-3">
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
