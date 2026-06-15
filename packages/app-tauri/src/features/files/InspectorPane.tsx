/**
 * InspectorPane — the right-side Inspector (design: prototype/04-engine.jsx
 * `Inspector`). A Files-tree / Changes tabbed panel scoped to the active
 * session's project. Toggled from the MainToolbar (`inspectorVisible`).
 * The bottom Tasks drawer is composed below the body when a project is active.
 */
import { useState, useEffect } from 'react';
import { FileText, GitCompare } from 'lucide-react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { onSurfaceIntent } from '@/store/surface-intents';
import { ChangesPanel } from './ChangesPanel';
import { FileTree } from './FileTree';
import { TasksDrawer } from '../tasks/TasksDrawer';
import { useStartTodoSession } from '../tasks/use-start-todo-session';

type Tab = 'files' | 'changes';

const SEG = 'flex h-[22px] flex-1 items-center justify-center gap-1.5 rounded-[6px] text-caption transition-colors';

export function InspectorPane({ port }: { port: number }) {
  const { projectId, chatId } = useActiveIdentity();
  const [tab, setTab] = useState<Tab>('files');
  const startTodoSession = useStartTodoSession(port, projectId);

  // Subscribe to inspector-tab intents so external triggers (e.g. the
  // SurfacePicker "View changes" button) can switch the active tab.
  useEffect(() => {
    return onSurfaceIntent((intent) => {
      if (intent.type === 'inspector-tab') {
        setTab(intent.tab);
      }
    });
  }, []);

  return (
    <aside
      data-testid="inspector-pane"
      className="flex w-[272px] flex-shrink-0 flex-col overflow-hidden rounded-[11px] bg-background shadow-[var(--mf-shadow-panel)]"
    >
      {/* Files / Changes tabs */}
      <div className="flex-shrink-0 p-2.5 pb-2">
        <div className="flex items-center gap-0.5 rounded-[8px] bg-mf-chip p-0.5">
          <button
            data-testid="inspector-tab-files"
            type="button"
            onClick={() => setTab('files')}
            aria-pressed={tab === 'files'}
            className={`${SEG} ${tab === 'files' ? 'bg-mf-tab-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <FileText size={11} />
            Files
          </button>
          <button
            data-testid="inspector-tab-changes"
            type="button"
            onClick={() => setTab('changes')}
            aria-pressed={tab === 'changes'}
            className={`${SEG} ${tab === 'changes' ? 'bg-mf-tab-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <GitCompare size={11} />
            Changes
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto mf-thin-scrollbar">
        {!projectId ? (
          <div className="px-3 py-4 text-caption text-muted-foreground">Open a session to browse its files.</div>
        ) : tab === 'files' ? (
          <FileTree port={port} projectId={projectId} chatId={chatId} />
        ) : (
          <ChangesPanel port={port} projectId={projectId} chatId={chatId} />
        )}
      </div>

      {/* Tasks drawer — mounted when a project is active; owns the load() effect */}
      {projectId && (
        <TasksDrawer port={port} projectId={projectId} onStartSession={(t) => void startTodoSession(t.id)} />
      )}
    </aside>
  );
}
