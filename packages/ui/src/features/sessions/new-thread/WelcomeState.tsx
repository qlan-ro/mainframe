/**
 * WelcomeState — the designed draft empty-state: project + branch context, a
 * headline, and up to 3 repo-derived suggestion rows that pre-fill the composer.
 * The "FROM THE REPO" section renders only when suggestions exist.
 *
 * The project is chosen HERE, not before the draft opens: the chip is a
 * picker, and until one is picked the screen shows the choose-project state
 * (no branch, no suggestions — and the composer stays hidden, since the first
 * send needs a project to create the chat in).
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, GitBranch } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { ProjectChip } from '@/components/ui/project-chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getGitBranch } from '@/lib/api/git';
import { BranchPopover } from '@/features/git/BranchPopover';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from '../ProjectAvatar';
import { useProjects } from '../use-projects';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useRepoSuggestions } from './use-repo-suggestions';
import { useSelectDraftProject } from './use-select-draft-project';
import { SuggestionRow } from './SuggestionRow';

/** The chip IS the project picker — the draft's project is chosen (or changed) here. */
function ProjectPicker({ projectId }: { projectId: string | undefined }) {
  const { projects } = useProjects();
  const selectProject = useSelectDraftProject();
  const projectName = projectId == null ? null : (projects.find((p) => p.id === projectId)?.name ?? projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="welcome-project"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted"
        >
          {projectId != null && projectName != null ? (
            <ProjectChip projectId={projectId} name={projectName} size={18} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
              <FolderOpen size={14} aria-hidden />
              Choose a project
            </span>
          )}
          <ChevronDown size={12} className="text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid="welcome-project-picker" align="start" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="text-muted-foreground">Start in…</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            data-testid={`welcome-project-${project.id}`}
            onSelect={() => void selectProject(project.id)}
          >
            <ProjectAvatar name={project.name} color={projectColor(project.id)} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WelcomeState({ projectId }: { projectId?: string }) {
  const port = useDaemonPort();
  const aui = useAui();
  const { suggestions } = useRepoSuggestions(projectId ?? null);
  const [branch, setBranch] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadBranch = useCallback(() => {
    if (projectId == null) return;
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
          <ProjectPicker projectId={projectId} />
          {projectId != null && branch != null && (
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
          <p className="text-sm text-muted-foreground">
            {projectId != null
              ? 'Describe a task, or pick a starting point below.'
              : 'Choose a project to get started.'}
          </p>
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
