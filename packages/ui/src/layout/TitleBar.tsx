/**
 * TitleBar — the 48px strip across the top of the window, on the shell's
 * `sidebar` ground. It is the ONE window drag region (`data-drag-region`;
 * interactive children are excluded by the host's mousedown handler) and it
 * is in normal flow — nothing `fixed`.
 *
 * It is cut into segments that line up with the columns below (W1), each
 * separator measured from the column edge it stands on (`column-edges`):
 *
 *   [lights + usage capsule] | [session tabs] | [workspace tabs + Files] | [search, Chat, Workspace]
 *
 *   - The first separator stands on the sidebar's right edge. With the sidebar
 *     collapsed there is no edge, so it follows the capsule.
 *   - The second stands on the workspace panel's left edge and the third closes
 *     that segment; both show only while the workspace does.
 *
 * Only the Chats view fills it: in Tasks / Automations / Setup Advisor /
 * Settings the bar keeps just the lights, the capsule, the drag region and
 * (collapsed) the show-sidebar button.
 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useSidebar } from '@/components/ui/sidebar';
import { USAGE_CAPSULE_WIDTH, UsageCapsule } from '@/features/quota/UsageCapsule';
import { SessionTabs } from '@/features/session-tabs/SessionTabs';
import { cn } from '@/lib/utils';
import { isSurfaceLit, useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import { useColumnEdges } from './column-edges';
import { TitleBarActions } from './TitleBarActions';
import { TitleBarSeparator } from './TitleBarSeparator';
import { TitleBarWorkspace } from './TitleBarWorkspace';
import { SidebarLeftGlyph } from './surface-icons';

/** The native traffic-light cluster: 3 buttons + gaps + the 20px inset, ≈72–80px. */
const TRAFFIC_LIGHTS_WIDTH = 80;
/** Between the usage capsule and the separator that follows it. */
const CAPSULE_GAP = 12;
/** Below this the capsule is no use; the narrowest sidebar still leaves it more. */
const MIN_CAPSULE_WIDTH = 160;

/**
 * Lights, capsule and the first separator. While the sidebar is open the
 * segment ends on the sidebar's hairline and the capsule takes what is left. The
 * minimum only holds while the sidebar slides open: at rest even the narrowest
 * sidebar ends past it.
 */
function SidebarSegment({ open, separator }: { open: boolean; separator: boolean }) {
  const edge = useColumnEdges((s) => s.content);
  const aligned = open && edge != null;
  return (
    <div
      data-testid="title-bar-sidebar-segment"
      data-collapsed={open ? undefined : ''}
      className="flex h-full shrink-0 items-center"
      style={
        aligned ? { width: edge, minWidth: TRAFFIC_LIGHTS_WIDTH + MIN_CAPSULE_WIDTH + CAPSULE_GAP + 1 } : undefined
      }
    >
      <div aria-hidden className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
      <div className={cn('flex min-w-0', aligned && 'flex-1')} style={{ paddingRight: CAPSULE_GAP }}>
        <UsageCapsule width={aligned ? '100%' : USAGE_CAPSULE_WIDTH} />
      </div>
      {separator ? (
        <TitleBarSeparator testId="title-bar-separator-sidebar" />
      ) : (
        <span aria-hidden className="w-px shrink-0" />
      )}
    </div>
  );
}

/**
 * Everything right of the session tabs. With the workspace beside the chat it
 * starts on the workspace's hairline; with the workspace alone or in the bottom
 * strip there is no edge to stand on, so it takes the room its tabs need.
 * Children arrive as elements so an edge moving under a drag re-renders this
 * frame and nothing inside it.
 */
function TrailingSegment({ workspaceLit, children }: { workspaceLit: boolean; children: ReactNode }) {
  const edge = useColumnEdges((s) => s.workspace);
  const aligned = workspaceLit && edge != null;
  return (
    <div
      data-testid="title-bar-trailing"
      className={cn(
        'flex h-full items-center pr-3',
        // Over a narrow panel the gaps inside tighten, so the tabs get the room.
        aligned && '@container/trailing',
        aligned || !workspaceLit ? 'shrink-0' : 'max-w-1/2 min-w-0 flex-initial',
      )}
      style={aligned ? { width: `calc(100% - ${edge - 1}px)` } : undefined}
    >
      {children}
    </div>
  );
}

export function TitleBar() {
  const { open, setOpen } = useSidebar();
  // Outside Chats the bar is bare window chrome (Codex-style): the tabs, the
  // chat actions belong to the chat surface.
  const chats = useUiPrefs((s) => s.sidebarView) === 'chats';
  const workspaceLit = useLayoutStore((s) => isSurfaceLit(s.layout, 'workspace'));

  return (
    <div data-testid="title-bar" data-drag-region className="flex h-12 shrink-0 items-center bg-sidebar">
      <SidebarSegment open={open} separator={chats} />

      {/* No padding of its own: it would hold 4px when the columns leave this segment none. */}
      <div data-testid="title-bar-chat-column" className="h-full min-w-0 flex-1 overflow-hidden">
        <div className="flex h-full min-w-0 items-center gap-2 pl-1">
          {!open && (
            <Hint label="Show sidebar">
              <Button
                data-testid="show-sidebar-button"
                aria-label="Show sidebar"
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(true)}
                className="text-muted-foreground"
              >
                <SidebarLeftGlyph size={16} />
              </Button>
            </Hint>
          )}
          {chats && <SessionTabs />}
        </div>
      </div>

      {chats && (
        <TrailingSegment workspaceLit={workspaceLit}>
          {workspaceLit && (
            <>
              <TitleBarSeparator testId="title-bar-separator-workspace" />
              <TitleBarWorkspace />
              <TitleBarSeparator testId="title-bar-separator-actions" className="mx-2 @max-[26rem]/trailing:mx-1" />
            </>
          )}
          <TitleBarActions />
        </TrailingSegment>
      )}
    </div>
  );
}
