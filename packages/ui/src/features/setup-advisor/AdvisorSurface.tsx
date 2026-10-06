/**
 * AdvisorSurface — the body's Setup Advisor view (the `SidebarInset` content
 * while `sidebarView` is 'advisor', D1/D8). The project's recommendations or
 * skills section, or a pick list when the session scope names no single
 * project (D7, same rule as Tasks) — picking narrows the shared scope, so
 * Chats/Tasks/Automations follow.
 *
 * Replaces the old `SetupAdvisorHost` dialog: loads the report on mount and
 * whenever the resolved project changes (mount IS "fresh open" now, since
 * this only renders while the view is active), dropping the stale report
 * first via `clearForProjectSwitch` — the store's `_loadSeq` guard already
 * makes a late response from the old project a no-op, and clearing keeps the
 * store from holding a report nobody can render).
 */
import { useEffect, useRef } from 'react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useProjects } from '@/features/sessions/use-projects';
import { ProjectPickList } from '@/features/project-scope/ProjectPickList';
import { projectsInScopeOrAll, soleProjectId, useSessionFilters } from '@/store/session-filters';
import { useSetupAdvisor } from './use-setup-advisor';
import { selectCopiedCount, useSetupAdvisorStore } from './use-setup-advisor-store';
import { SetupAdvisorSheet } from './SetupAdvisorSheet';
import { SkillsSection } from './skills/SkillsSection';

/** Module-scoped so a project with no copy history hands the sheet a stable prop. */
const EMPTY_COPIED: ReadonlySet<string> = new Set();

export function AdvisorSurface() {
  const section = useSetupAdvisor((s) => s.section);
  const { projects } = useProjects();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const soloFilterProject = useSessionFilters((s) => s.soloFilterProject);
  const projectId = soleProjectId(filterProjectIds);
  // The active session's adapter, not the scoped project's — the advisor's
  // Skills section only uses it to pick a default CLI skill location.
  const { adapterId } = useActiveIdentity();
  const { report, reportProjectId, loading, error, copiedByProject, load, clearForProjectSwitch, markCopied } =
    useSetupAdvisorStore();
  const copiedCount = useSetupAdvisorStore(selectCopiedCount);

  const prevProjectId = useRef<string | null>(null);
  useEffect(() => {
    if (projectId == null) {
      prevProjectId.current = null;
      return;
    }
    if (projectId !== prevProjectId.current) {
      clearForProjectSwitch();
      void load(projectId);
    }
    prevProjectId.current = projectId;
  }, [projectId, load, clearForProjectSwitch]);

  if (projectId == null) {
    return (
      <div
        data-testid="advisor-surface-pick"
        className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-8"
      >
        <p className="text-sm text-muted-foreground">Pick the project to analyze.</p>
        <div className="w-full max-w-sm">
          <ProjectPickList
            surface="advisor"
            projects={projectsInScopeOrAll(projects, filterProjectIds)}
            filterProjectId={null}
            onSelect={soloFilterProject}
          />
        </div>
      </div>
    );
  }

  const copiedIds = copiedByProject[projectId] ?? EMPTY_COPIED;
  // The clearing effect runs after commit, so on a project switch this render
  // still sees the old project's report. Gating on the id it was fetched for
  // keeps those rows from ever appearing under the new project's name.
  const reportForProject = reportProjectId === projectId ? report : null;

  return (
    <div data-testid="advisor-surface" className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
    </div>
  );
}
