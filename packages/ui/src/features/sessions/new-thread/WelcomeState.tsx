/**
 * WelcomeState — the designed draft empty-state: project + branch context, a
 * headline, and up to 3 repo-derived suggestion rows that pre-fill the composer.
 * The "FROM THE REPO" section renders only when suggestions exist.
 */
import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { ProjectChip } from '@/components/ui/project-chip';
import { getGitBranch } from '@/lib/api/git';
import { useProjects } from '../use-projects';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useRepoSuggestions } from './use-repo-suggestions';
import { SuggestionRow } from './SuggestionRow';

export function WelcomeState({ projectId }: { projectId: string }) {
  const port = useDaemonPort();
  const aui = useAui();
  const { projects } = useProjects();
  const { suggestions } = useRepoSuggestions(projectId);
  const [branch, setBranch] = useState<string | null>(null);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? projectId;

  useEffect(() => {
    let cancelled = false;
    getGitBranch(port, projectId)
      .then((r) => {
        if (!cancelled) setBranch(r.branch);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBranch(null);
        console.warn('[WelcomeState] getGitBranch failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId]);

  const insert = (prefill: string) => aui.composer().setText(prefill);

  return (
    // Fill the scroll area and center the column vertically + horizontally (spec
    // Change 4: "min-height 100% of the scroll area, so it scrolls on short panes").
    <div data-testid="sessions-welcome" className="flex min-h-full flex-col justify-center py-10">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5">
        <div className="flex items-center gap-2">
          <ProjectChip projectId={projectId} name={projectName} size={18} />
          {branch != null && (
            <span className="inline-flex items-center gap-1 text-caption text-mf-text-3">
              <GitBranch size={12} />
              <span className="font-mono">{branch}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-title font-semibold text-foreground">What should we take on?</h1>
          <p className="text-body text-muted-foreground">Describe a task, or pick a starting point below.</p>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-micro font-bold tracking-wide text-muted-foreground">FROM THE REPO</div>
            {suggestions.map((s, i) => (
              <SuggestionRow key={`${s.icon}-${s.title}`} suggestion={s} index={i} onInsert={insert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
