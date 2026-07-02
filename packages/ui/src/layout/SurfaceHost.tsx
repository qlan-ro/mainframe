import { Fragment, memo, useCallback, useEffect, useRef } from 'react';
import { ChatSurface } from '@/features/sessions/new-thread/ChatSurface';
import type { SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';
import { useTheme } from '@/store/theme';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { onSurfaceIntent } from '@/store/surface-intents';
import { subscribeToFileIntents } from '@/store/intent-subscriber';
import { subscribeToTerminalIntents } from '@/store/terminal-intent-subscriber';
import { SurfaceDragLayer } from './SurfaceDragLayer';
import { SurfDivider } from './SurfDivider';
import { FilesSurface } from './surfaces/FilesSurface';
import { RunSurface } from './surfaces/RunSurface';

const SHORTCUT_MAP: Record<string, SurfaceId> = {
  '1': 'chat',
  '2': 'files',
  '3': 'run',
};

// Each surface is its own rounded floating card (geo.surface), per the prototype
// (04-engine `surfCard`); the MainToolbar sits transparent on the window background,
// NOT inside a white card.
const PANEL_LAYOUT = 'flex flex-col overflow-hidden';

function SurfaceView({ name, port }: { name: SurfaceId; port: number }) {
  if (name === 'chat') return <ChatSurface port={port} />;
  if (name === 'files') return <FilesSurface />;
  return <RunSurface />;
}

interface Props {
  port: number;
}

function SurfaceHostImpl({ port }: Props) {
  const layout = useLayoutStore((s) => s.layout);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const setTopFrac = useLayoutStore((s) => s.setTopFrac);
  const setVFrac = useLayoutStore((s) => s.setVFrac);
  const windowStyle = useTheme((s) => s.windowStyle);
  const geo = windowStyleGeometry(windowStyle);
  const panelCls = `${PANEL_LAYOUT} ${geo.surface}`;

  const outerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Stable subscription — reads live store state inside the callback, no re-sub on toggle.
  useEffect(() => {
    return onSurfaceIntent((intent) => {
      if (intent.type !== 'activate-surface') return;
      const state = useLayoutStore.getState();
      const cur = state.layout;
      const isActive = cur.top.includes(intent.surface) || cur.bottom === intent.surface;
      if (!isActive) state.toggleSurface(intent.surface);
    });
  }, []);

  // Subscribe to open-file / reveal-file intents — opens tabs + activates Files surface.
  // One stable subscription; no re-sub on layout change.
  useEffect(() => {
    return subscribeToFileIntents();
  }, []);

  // Subscribe to new-terminal intents — resolves cwd, creates PTY+xterm, adds RunTab.
  // One stable subscription; no re-sub on layout change.
  useEffect(() => {
    return subscribeToTerminalIntents();
  }, []);

  // Cmd/Ctrl + 1/2/3 toggle Chat/Files/Run.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const surface = SHORTCUT_MAP[e.key];
      if (!surface) return;
      e.preventDefault();
      toggleSurface(surface);
    },
    [toggleSurface],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const { top, bottom, topFlex, vFlex } = layout;
  const twoCol = top.length === 2;

  return (
    <div data-testid="chat-thread-area" ref={outerRef} className="flex flex-1 flex-col overflow-hidden">
      {/* Top row: 1 or 2 surfaces side by side. */}
      <div ref={topRef} style={{ flex: bottom ? vFlex.top : 1 }} className="flex min-h-0 overflow-hidden">
        {top.map((name, i) => (
          <Fragment key={name}>
            <div data-drop-surface={name} style={{ flex: topFlex[name] ?? 1 }} className={`min-w-0 ${panelCls}`}>
              <SurfaceView name={name} port={port} />
            </div>
            {i < top.length - 1 &&
              (twoCol ? (
                <SurfDivider axis="x" containerRef={topRef} onFrac={setTopFrac} lineClass={geo.divider} />
              ) : (
                <div style={{ width: 6, flexShrink: 0 }} />
              ))}
          </Fragment>
        ))}
      </div>

      {/* Vertical divider + bottom strip. */}
      {bottom && (
        <>
          <SurfDivider axis="y" containerRef={outerRef} onFrac={setVFrac} lineClass={geo.divider} />
          <div style={{ flex: vFlex.bottom }} className="flex min-h-0 overflow-hidden">
            <div data-drop-surface={bottom} className={`min-w-0 flex-1 ${panelCls}`}>
              <SurfaceView name={bottom} port={port} />
            </div>
          </div>
        </>
      )}
      <SurfaceDragLayer />
    </div>
  );
}

// Memoized: `port` is stable, so SurfaceHost (and the mounted surfaces beneath it)
// re-render only on their OWN store subscriptions (layout/theme), NOT every time the
// parent RuntimeBody re-renders on a sidebar-resize pixel or a session switch.
export const SurfaceHost = memo(SurfaceHostImpl);
