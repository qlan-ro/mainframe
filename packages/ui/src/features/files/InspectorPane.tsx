/**
 * InspectorPane — the right-side Inspector (design: prototype/04-engine.jsx
 * `Inspector`). A Files-tree / Changes tabbed panel scoped to the active
 * session's project. Toggled from the MainToolbar (`inspectorVisible`).
 * The bottom Tasks drawer is composed below the body when a project is active.
 */
import { useState, useEffect } from 'react';
import { Folder, GitCompare } from 'lucide-react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { onSurfaceIntent } from '@/store/surface-intents';
import { cn } from '@/lib/utils';
import { useTheme } from '@/store/theme';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { ChangesPanel } from './ChangesPanel';
import { FileTree } from './FileTree';
import { TasksDrawer } from '../tasks/TasksDrawer';
import { useStartTodoSession } from '../tasks/use-start-todo-session';
import { useChangesCount } from './use-changes-count';

type Tab = 'files' | 'changes';

const SEG_BASE =
  'flex h-[22px] flex-1 items-center justify-center gap-[5px] rounded-[6px] text-caption transition-colors';

export function InspectorPane({ port }: { port: number }) {
  const { projectId, chatId } = useActiveIdentity();
  const windowStyle = useTheme((s) => s.windowStyle);
  const geo = windowStyleGeometry(windowStyle);
  const [tab, setTab] = useState<Tab>('files');
  const startTodoSession = useStartTodoSession(port, projectId);
  const changesCount = useChangesCount(port, projectId, chatId);

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
      className={cn('flex w-[280px] flex-shrink-0 flex-col overflow-hidden font-sans text-foreground', geo.inspector)}
    >
      {/* Files / Changes tabs */}
      <div className="flex-shrink-0 pt-[10px] px-[12px] pb-[8px]">
        <div className="flex items-center gap-0.5 rounded-[8px] bg-mf-chip p-0.5">
          <button
            data-testid="inspector-tab-files"
            type="button"
            onClick={() => setTab('files')}
            aria-pressed={tab === 'files'}
            className={`${SEG_BASE} ${
              tab === 'files'
                ? 'bg-mf-tab-active font-semibold text-foreground shadow-[var(--mf-shadow-rail-active)]'
                : 'font-medium text-muted-foreground hover:text-foreground'
            }`}
          >
            <Folder size={11} />
            Files
          </button>
          <button
            data-testid="inspector-tab-changes"
            type="button"
            onClick={() => setTab('changes')}
            aria-pressed={tab === 'changes'}
            className={`${SEG_BASE} ${
              tab === 'changes'
                ? 'bg-mf-tab-active font-semibold text-foreground shadow-[var(--mf-shadow-rail-active)]'
                : 'font-medium text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitCompare size={11} />
            Changes
            {changesCount > 0 && <span className="font-mono text-micro text-mf-text-3">{changesCount}</span>}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
