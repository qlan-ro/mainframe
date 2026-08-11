/**
 * WelcomeState — the designed draft empty-state: project + branch context, a
 * headline, and up to 3 repo-derived suggestion rows that pre-fill the composer.
 * The "FROM THE REPO" section renders only when suggestions exist.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { ProjectChip } from '@/components/ui/project-chip';
import { getGitBranch } from '@/lib/api/git';
import { BranchPopover } from '@/features/git/BranchPopover';
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? projectId;

  const loadBranch = useCallback(() => {
    getGitBranch(port, projectId)
      .then((r) => setBranch(r.branch))
      .catch((err: unknown) => {
        setBranch(null);
        console.warn('[WelcomeState] getGitBranch failed', err);
      });
  }, [port, projectId]);

  useEffect(() => {
    setBranch(null);
    loadBranch();
  }, [loadBranch]);

  const insert = (prefill: string) => aui.composer.setText(prefill);

  return (
    // Fill the scroll area and center the column vertically + horizontally (spec
    // Change 4: "min-height 100% of the scroll area, so it scrolls on short panes").
    <div data-testid="sessions-welcome" className="flex min-h-full flex-col justify-center py-10">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5">
        <div className="flex items-center gap-2">
          <ProjectChip projectId={projectId} name={projectName} size={18} />
          {branch != null && (
            // The draft's branch manager (the titlebar chip is gone): a fresh
            // session starts from whatever branch is picked here.
            <BranchPopover
              port={port}
              projectId={projectId}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onBranchChanged={loadBranch}
              triggerLabel="Switch branch"
            >
              {/* No onClick of its own: DropdownMenuTrigger toggles on
                  pointerdown, and a second toggle here closes it on release. */}
              <button
                type="button"
                data-testid="welcome-branch"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <GitBranch size={12} />
                <span className="font-mono">{branch}</span>
                <ChevronDown size={10} aria-hidden />
              </button>
            </BranchPopover>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-foreground">What should we take on?</h1>
          <p className="text-sm text-muted-foreground">Describe a task, or pick a starting point below.</p>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">From the repo</div>
            {suggestions.map((s, i) => (
              <SuggestionRow key={`${s.icon}-${s.title}`} suggestion={s} index={i} onInsert={insert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
