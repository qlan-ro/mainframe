/**
 * FirstRunState — the zero-projects hero. A primary "Add project…" CTA
 * (reusing the existing useDirectoryPicker → createProject seam) and a
 * secondary "Start with no project" CTA of equal height next to it (todo
 * #346): it scopes the draft to "No project" the same way the welcome
 * screen's picker does, which replaces this hero with the normal welcome
 * screen — set to "No project" — with a live composer.
 */
import { FolderGit2, FolderPlus, SquareDashedBottom } from 'lucide-react';
import { useProjects } from '../use-projects';
import { useAddProject } from '../use-add-project';
import { useSelectDraftProject } from './use-select-draft-project';

export function FirstRunState() {
  const { reloadProjects } = useProjects();
  const addProject = useAddProject(reloadProjects);
  const selectProject = useSelectDraftProject();

  return (
    <div
      data-testid="sessions-firstrun"
      className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-4 py-12 text-center"
    >
      <span
        aria-hidden
        className="flex size-[44px] items-center justify-center rounded-[12px]"
        style={{ color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 7%, transparent)' }}
      >
        <FolderGit2 size={22} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-foreground">Welcome to Mainframe</h1>
        <p className="text-sm text-muted-foreground">
          Add a project folder to start orchestrating agents on your codebase. We’ll show you around once it’s in.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="sessions-firstrun-add-project"
          onClick={() => void addProject()}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <FolderPlus size={14} />
          Add project…
        </button>
        <button
          type="button"
          data-testid="sessions-firstrun-no-project"
          onClick={() => void selectProject(null)}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-border px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <SquareDashedBottom size={14} />
          Start with no project
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Your files stay on disk — Mainframe only tracks session metadata.</p>
    </div>
  );
}
