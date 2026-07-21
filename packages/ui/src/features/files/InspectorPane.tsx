/**
 * InspectorPane — the right-side Inspector (design: prototype/04-engine.jsx
 * `Inspector`). A Files-tree / Changes tabbed panel scoped to the active
 * session's project, with the Context/Skills/Agents panel (contextual detail
 * about the active session) composed below the body — HIG's right-inspector
 * role, swapped in from the left sidebar where Tasks (a navigable collection)
 * used to sit. Toggled from the MainToolbar (`inspectorVisible`).
 */
import { useState, useEffect } from 'react';
import { Folder, GitCompare } from 'lucide-react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { onSurfaceIntent } from '@/store/surface-intents';
import { cn } from '@/lib/utils';
import { useTheme } from '@/store/theme';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { CountBadge } from '@/components/ui/count-badge';
import { BottomPanel } from '@/features/context-panel/BottomPanel';
import { PanelResizeHandle } from '@/features/context-panel/PanelResizeHandle';
import { ChangesPanel } from './ChangesPanel';
import { FileTree } from './FileTree';
import { useChangesCount } from './use-changes-count';

type Tab = 'files' | 'changes';

const SEG_BASE =
  'flex h-[22px] flex-1 items-center justify-center gap-[5px] rounded-[6px] text-label transition-colors';

export function InspectorPane({ port }: { port: number }) {
  const { projectId, chatId } = useActiveIdentity();
  const windowStyle = useTheme((s) => s.windowStyle);
  const geo = windowStyleGeometry(windowStyle);
  const [tab, setTab] = useState<Tab>('files');
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
            <Folder size={14} />
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
            <GitCompare size={14} />
            Changes
            <CountBadge count={changesCount} variant="info" />
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

      {/* Context/Skills/Agents panel — contextual detail about the active session. */}
      <PanelResizeHandle containerTestId="inspector-pane" />
      <BottomPanel />
    </aside>
  );
}
