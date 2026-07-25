/**
 * SetupAdvisorHost — single app-root host for the Setup Advisor sheet, wiring
 * the nav store (useSetupAdvisor) to the data store (useSetupAdvisorStore) and
 * the active project (useActiveIdentity). Follows TasksModalHost: resolve
 * identity, gate on projectId, refetch on the open rising edge.
 *
 * One effect keyed on [open, openSeq, projectId]: fetch on the open rising
 * edge (or a repeat `openSeq` bump — see use-setup-advisor.ts for why a bare
 * boolean transition isn't enough), or on a projectId change while already
 * open (dropping the stale report first via clearForProjectSwitch — the
 * store's `_loadSeq` guard makes a late response from the old project a
 * no-op even without this, but clearing prevents the old project's rows from
 * flashing before the new fetch resolves). A project switch while closed
 * must not fetch (spec: no cache, but also no wasted fetches for a sheet
 * nobody is looking at).
 */
import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useSetupAdvisor } from './use-setup-advisor';
import { useSetupAdvisorStore } from './use-setup-advisor-store';
import { SetupAdvisorSheet } from './SetupAdvisorSheet';

export function SetupAdvisorHost() {
  const { open, openSeq, closeSheet } = useSetupAdvisor();
  const { projectId, projectName } = useActiveIdentity();
  const { report, loading, error, copiedByProject, load, clearForProjectSwitch, markCopied } =
    useSetupAdvisorStore();

  const prevOpen = useRef(false);
  const prevOpenSeq = useRef(-1);
  const prevProjectId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const isFreshOpen = open && !prevOpen.current;
    const seqChanged = open && openSeq !== prevOpenSeq.current;
    const projectChanged = projectId !== prevProjectId.current;
    prevOpen.current = open;
    prevOpenSeq.current = openSeq;
    prevProjectId.current = projectId;

    if (!projectId) return;
    if (isFreshOpen || seqChanged) {
      void load(projectId);
    } else if (open && projectChanged) {
      clearForProjectSwitch();
      void load(projectId);
    }
  }, [open, openSeq, projectId, load, clearForProjectSwitch]);

  if (!projectId) return null;

  const copiedIds = copiedByProject[projectId] ?? new Set<string>();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeSheet();
      }}
    >
      <DialogContent hideClose className="rounded-xl border border-border bg-card shadow-2xl max-w-[640px] p-0 gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Setup Advisor</DialogTitle>
        </DialogHeader>
        <SetupAdvisorSheet
          report={report}
          loading={loading}
          error={error}
          projectName={projectName}
          copiedIds={copiedIds}
          onCopy={(recId) => markCopied(projectId, recId)}
          onRetry={() => void load(projectId)}
        />
      </DialogContent>
    </Dialog>
  );
}
