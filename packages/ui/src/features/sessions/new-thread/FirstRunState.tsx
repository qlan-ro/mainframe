/**
 * FirstRunState — the zero-projects hero. A single "Add project…" CTA (reusing the
 * existing useDirectoryPicker → createProject seam) and no composer. Shown by
 * ChatSurface when useProjects().projects.length === 0.
 */
import { FolderGit2, FolderPlus } from 'lucide-react';
import { useProjects } from '../use-projects';
import { useAddProject } from '../use-add-project';

export function FirstRunState() {
  const { reloadProjects } = useProjects();
  const addProject = useAddProject(reloadProjects);

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
        <h1 className="text-title font-semibold text-foreground">Welcome to Mainframe</h1>
        <p className="text-body text-muted-foreground">
          Add a project folder to start orchestrating agents on your codebase.
        </p>
      </div>
      <button
        type="button"
        data-testid="sessions-firstrun-add-project"
        onClick={() => void addProject()}
        className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-primary px-3.5 text-caption font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <FolderPlus size={14} />
        Add project…
      </button>
      <p className="text-micro text-mf-text-4">Your files stay on disk — Mainframe only tracks session metadata.</p>
    </div>
  );
}
