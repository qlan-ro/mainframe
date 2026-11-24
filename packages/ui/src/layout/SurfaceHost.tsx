import { memo, useEffect, useRef } from 'react';
import { ChatSurface } from '@/features/sessions/new-thread/ChatSurface';
import { useLayoutStore } from '@/store/layout';
import { emitSurfaceIntent, onSurfaceIntent } from '@/store/surface-intents';
import { subscribeToFileIntents } from '@/store/intent-subscriber';
import { subscribeToTerminalIntents } from '@/store/terminal-intent-subscriber';
import { subscribeToUrlTabIntents } from '@/store/url-tab-intent-subscriber';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { cn } from '@/lib/utils';
import { useColumnEdge } from './column-edges';
import { SurfDivider } from './SurfDivider';
import { useWorkspaceSlide } from './use-workspace-slide';
import { WorkspaceSurface } from './surfaces/WorkspaceSurface';

const PANEL_LAYOUT = 'flex flex-col overflow-hidden bg-background';

/** W4: what each panel keeps. In a row too narrow for both, the workspace wins. */
const MIN_CHAT = 360;
const MIN_WORKSPACE = 320;

/**
 * The workspace's width beside the chat: its share of the row, half by default,
 * held between the two minimums (the chat's counts the 1px divider), or the row
 * less the divider when the row itself is narrower. In `cqw` of the row, so the
 * panel's content keeps its final width while the panel slides.
 */
const PANEL_WIDTH = 'w-[min(100cqw-1px,max(20rem,min(var(--mf-workspace-frac)*100cqw,100cqw-22.5rem-1px)))]';

/** Reports where the panel's left edge comes to rest, so the title bar does not chase the slide. */
function RestingEdge() {
  const ref = useColumnEdge('workspace');
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('pointer-events-none invisible absolute inset-y-0 right-0', PANEL_WIDTH)}
    />
  );
}

/** Opens and toggles surfaces on the app's intents and shortcuts. One stable subscription each. */
function useSurfaceIntents() {
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  useEffect(() => {
    return onSurfaceIntent((intent) => {
      if (intent.type !== 'activate-surface') return;
      const state = useLayoutStore.getState();
      if (!state.layout.top.includes(intent.surface)) state.toggleSurface(intent.surface);
    });
  }, []);
  // open-file / reveal-file: opens tabs + lights the workspace.
  useEffect(() => subscribeToFileIntents(), []);
  // new-terminal: resolves cwd, creates PTY+xterm, adds a tab.
  useEffect(() => subscribeToTerminalIntents(), []);
  // open-url-tab: normalizes the URL and adds the tab.
  useEffect(() => subscribeToUrlTabIntents(), []);

  // These TOGGLE their surface — the `activate-surface` intent only lights an
  // inactive one, so routing them through it would silently drop the "press
  // again to hide" half of the shipped behavior.
  useShortcutAction('workspace.toggle-chat', () => toggleSurface('chat'));
  useShortcutAction('workspace.toggle-workspace', () => toggleSurface('workspace'));
  // Goes through the intent rather than calling the terminal store: the
  // subscriber resolves the cwd, spawns the PTY and lights the surface, so the
  // chord and the picker row can never diverge.
  useShortcutAction('workspace.new-terminal', () => emitSurfaceIntent({ type: 'new-terminal' }));
  useShortcutAction('workspace.new-url-tab', () => emitSurfaceIntent({ type: 'open-url-tab' }));
}

function SurfaceHostImpl() {
  const layout = useLayoutStore((s) => s.layout);
  const sessionId = useLayoutStore((s) => s.activeSessionId);
  const setTopFrac = useLayoutStore((s) => s.setTopFrac);
  useSurfaceIntents();

  const rowRef = useRef<HTMLDivElement>(null);
  const chatLit = layout.top.includes('chat');
  const workspaceLit = layout.top.includes('workspace');
  const phase = useWorkspaceSlide({ lit: workspaceLit, beside: chatLit, sessionId });
  const beside = chatLit && phase !== 'closed';
  const workspaceFrac = layout.topFlex.workspace ?? 0.5;

  return (
    <div data-testid="chat-thread-area" className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={rowRef}
        style={{ '--mf-workspace-frac': workspaceFrac } as React.CSSProperties}
        className="@container relative flex min-h-0 flex-1 overflow-hidden"
      >
        {chatLit && (
          <div data-surface="chat" className={cn('min-w-0 flex-1', PANEL_LAYOUT)}>
            <ChatSurface />
          </div>
        )}
        {chatLit && workspaceLit && <RestingEdge />}
        {beside && (
          <SurfDivider
            containerRef={rowRef}
            frac={1 - workspaceFrac}
            minLeft={MIN_CHAT}
            minRight={MIN_WORKSPACE}
            onFrac={setTopFrac}
          />
        )}
        {phase !== 'closed' && (
          <div
            data-surface="workspace"
            data-slide={phase}
            inert={phase === 'closing'}
            className={cn(
              'relative min-w-0 overflow-hidden bg-background',
              !chatLit && 'flex-1',
              chatLit && 'shrink-0',
              chatLit && (phase === 'closing' ? 'w-0' : PANEL_WIDTH),
              (phase === 'opening' || phase === 'closing') &&
                'transition-[width] duration-[320ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none',
              phase === 'opening' && 'starting:w-0',
            )}
          >
            <div className={cn('absolute inset-y-0 left-0', PANEL_LAYOUT, chatLit ? PANEL_WIDTH : 'w-full')}>
              <WorkspaceSurface leaving={phase === 'closing'} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized: SurfaceHost takes no props, so it (and the mounted surfaces beneath it)
// re-render only on their OWN store subscriptions (layout/theme), NOT every time the
// parent RuntimeBody re-renders on a sidebar-resize pixel or a session switch.
export const SurfaceHost = memo(SurfaceHostImpl);
