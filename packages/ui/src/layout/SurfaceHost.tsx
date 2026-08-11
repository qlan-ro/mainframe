import { Fragment, memo, useCallback, useEffect, useRef } from 'react';
import { ChatSurface } from '@/features/sessions/new-thread/ChatSurface';
import type { SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';
import { onSurfaceIntent } from '@/store/surface-intents';
import { subscribeToFileIntents } from '@/store/intent-subscriber';
import { subscribeToTerminalIntents } from '@/store/terminal-intent-subscriber';
import { subscribeToUrlTabIntents } from '@/store/url-tab-intent-subscriber';
import { SurfaceDragLayer } from './SurfaceDragLayer';
import { SurfDivider } from './SurfDivider';
import { WorkspaceSurface } from './surfaces/WorkspaceSurface';

const SHORTCUT_MAP: Record<string, SurfaceId> = {
  '1': 'chat',
  '2': 'workspace',
};

// Each surface is its own rounded floating card, per the prototype (04-engine
// `surfCard`); the MainToolbar sits transparent on the window background, NOT
// inside a white card.
const PANEL_LAYOUT = 'flex flex-col overflow-hidden bg-background';

// Gutter width in px — both dividers and the single-column spacer must agree.
const DIVIDER_GUTTER = 9;

function SurfaceView({ name }: { name: SurfaceId }) {
  if (name === 'chat') return <ChatSurface />;
  return <WorkspaceSurface />;
}

function SurfaceHostImpl() {
  const layout = useLayoutStore((s) => s.layout);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const setTopFrac = useLayoutStore((s) => s.setTopFrac);
  const setVFrac = useLayoutStore((s) => s.setVFrac);

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

  // Subscribe to open-file / reveal-file intents — opens tabs + lights the workspace.
  // One stable subscription; no re-sub on layout change.
  useEffect(() => {
    return subscribeToFileIntents();
  }, []);

  // Subscribe to new-terminal intents — resolves cwd, creates PTY+xterm, adds a tab.
  // One stable subscription; no re-sub on layout change.
  useEffect(() => {
    return subscribeToTerminalIntents();
  }, []);

  // Subscribe to open-url-tab intents — normalizes the URL and adds the tab.
  useEffect(() => {
    return subscribeToUrlTabIntents();
  }, []);

  // Cmd/Ctrl + 1/2 toggle Chat / Workspace.
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
            {/* A lone pane always takes the whole row: drag fractions are < 1,
                and a flex row whose grow factors sum below 1 hands out only
                that fraction of its free space — the stale weight would leave
                the survivor at 30-something percent after a close. The weights
                stay in the store so re-opening restores the dragged ratio
                (same guard the vertical axis has via `bottom ? vFlex.top : 1`). */}
            <div
              data-drop-surface={name}
              style={{ flex: twoCol ? (topFlex[name] ?? 1) : 1 }}
              className={`min-w-0 ${PANEL_LAYOUT}`}
            >
              <SurfaceView name={name} />
            </div>
            {i < top.length - 1 &&
              (twoCol ? (
                <SurfDivider
                  axis="x"
                  containerRef={topRef}
                  onFrac={setTopFrac}
                  lineClass="bg-border"
                  gutter={DIVIDER_GUTTER}
                />
              ) : (
                <div style={{ width: DIVIDER_GUTTER, flexShrink: 0 }} />
              ))}
          </Fragment>
        ))}
      </div>

      {/* Vertical divider + bottom strip. */}
      {bottom && (
        <>
          <SurfDivider
            axis="y"
            containerRef={outerRef}
            onFrac={setVFrac}
            lineClass="bg-border"
            gutter={DIVIDER_GUTTER}
          />
          <div style={{ flex: vFlex.bottom }} className="flex min-h-0 overflow-hidden">
            <div data-drop-surface={bottom} className={`min-w-0 flex-1 ${PANEL_LAYOUT}`}>
              <SurfaceView name={bottom} />
            </div>
          </div>
        </>
      )}
      <SurfaceDragLayer />
    </div>
  );
}

// Memoized: SurfaceHost takes no props, so it (and the mounted surfaces beneath it)
// re-render only on their OWN store subscriptions (layout/theme), NOT every time the
// parent RuntimeBody re-renders on a sidebar-resize pixel or a session switch.
export const SurfaceHost = memo(SurfaceHostImpl);
