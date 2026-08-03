/**
 * SetupAdvisorHost — single app-root host for the Setup Advisor sheet, wiring
 * the nav store (useSetupAdvisor) to the data store (useSetupAdvisorStore) and
 * the active project (useActiveIdentity). Follows TasksModalHost: resolve
 * identity, gate on projectId, refetch on the open rising edge.
 *
 * One effect keyed on [open, projectId]: fetch on the open rising edge, or on
 * a projectId change while already open (dropping the stale report first via
 * clearForProjectSwitch — the store's `_loadSeq` guard already makes a late
 * response from the old project a no-op, and clearing keeps the store from
 * holding a report nobody can render). A project switch while closed must not
 * fetch (spec: no cache, but also no wasted fetches for a sheet nobody is
 * looking at).
 *
 * The effect cannot prevent the flash on its own — it runs after the render
 * that already saw the new projectId — so the report is gated on
 * `reportProjectId` at the prop boundary below.
 *
 * The header's section switcher only swaps the body; the recommendation fetch
 * is keyed on [open, projectId] alone, so opening straight onto Skills still
 * loads the report exactly once.
 */
import { useEffect, useRef } from 'react';
import { ScanSearch } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useSetupAdvisor } from './use-setup-advisor';
import { selectCopiedCount, useSetupAdvisorStore } from './use-setup-advisor-store';
import { SectionSwitcher } from './SectionSwitcher';
import { SetupAdvisorSheet } from './SetupAdvisorSheet';
import { SkillsSection } from './skills/SkillsSection';

/** Module-scoped so a project with no copy history hands the sheet a stable prop. */
const EMPTY_COPIED: ReadonlySet<string> = new Set();

export function SetupAdvisorHost() {
  const { open, section, closeSheet, setSection } = useSetupAdvisor();
  const { projectId, projectName, adapterId } = useActiveIdentity();
  const { report, reportProjectId, loading, error, copiedByProject, load, clearForProjectSwitch, markCopied } =
    useSetupAdvisorStore();
  const copiedCount = useSetupAdvisorStore(selectCopiedCount);

  const prevOpen = useRef(false);
  const prevProjectId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const isFreshOpen = open && !prevOpen.current;
    const projectChanged = projectId !== prevProjectId.current;
    prevOpen.current = open;
    prevProjectId.current = projectId;

    if (!projectId) return;
    if (isFreshOpen) {
      void load(projectId);
    } else if (open && projectChanged) {
      clearForProjectSwitch();
      void load(projectId);
    }
  }, [open, projectId, load, clearForProjectSwitch]);

  if (!projectId) return null;

  const copiedIds = copiedByProject[projectId] ?? EMPTY_COPIED;
  // The clearing effect runs after commit, so on a project switch this render
  // still sees the old project's report. Gating on the id it was fetched for
  // keeps those rows from ever appearing under the new project's name.
  const reportForProject = reportProjectId === projectId ? report : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeSheet();
      }}
    >
      <DialogContent
        data-testid="automation-recommender-sheet"
        className="flex max-h-[85vh] w-full max-w-[640px] flex-col gap-0 p-0"
      >
        {/* pr-9 clears the dialog's built-in close button (26px at right-3). */}
        <DialogHeader className="shrink-0 flex-row items-center gap-2 border-b border-border px-4 py-3 pr-9">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-heading font-bold">
            <ScanSearch size={14} className="shrink-0 text-primary" aria-hidden />
            Setup Advisor
            <span className="min-w-0 truncate text-body font-medium text-muted-foreground">{projectName}</span>
          </DialogTitle>
          <SectionSwitcher section={section} onSelect={setSection} />
        </DialogHeader>
        {section === 'skills' ? (
          <SkillsSection projectId={projectId} adapterId={adapterId} />
        ) : (
          <SetupAdvisorSheet
            report={reportForProject}
            loading={loading}
            error={error}
            copiedIds={copiedIds}
            copiedCount={copiedCount}
            onCopy={(recId) => markCopied(projectId, recId)}
            onRetry={() => void load(projectId)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
