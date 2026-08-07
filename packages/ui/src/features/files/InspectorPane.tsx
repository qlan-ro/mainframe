/**
 * InspectorPane — the right-side Inspector: the active session's project file
 * tree, and nothing else. Toggled from the MainToolbar (`inspectorVisible`).
 *
 * It used to carry a Changes tab and a Context/Skills/Agents panel below the
 * body; both moved to the session panel (the review modal's scope switcher owns
 * the change scopes now), leaving one surface with one job.
 */
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { cn } from '@/lib/utils';
import { SHELL_GEOMETRY } from '@/lib/appearance/shell-geometry';
import { FileTree } from './FileTree';

export function InspectorPane({ port }: { port: number }) {
  const { projectId, chatId } = useActiveIdentity();
  const geo = SHELL_GEOMETRY;

  return (
    <aside
      data-testid="inspector-pane"
      className={cn('flex w-[280px] flex-shrink-0 flex-col overflow-hidden font-sans text-foreground', geo.inspector)}
    >
      {/* pt-2.5 carries the 10px top inset the deleted tab band used to give the body. */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-2.5">
        {!projectId ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
        ) : (
          <FileTree port={port} projectId={projectId} chatId={chatId} />
        )}
      </div>
    </aside>
  );
}
