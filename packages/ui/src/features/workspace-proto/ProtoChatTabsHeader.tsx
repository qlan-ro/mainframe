/**
 * THROWAWAY PROTOTYPE — variant D: the chat surface header AS a chrome-style
 * tab bar. Replaces ChatCardHeader wholesale (title/model chip/PR pills move
 * into or behind the tabs — an open question this mock exists to expose). The
 * real split/hide controls are kept so the row's full population is judged,
 * not an idealized empty one.
 */
import { EyeOff, GripHorizontal, LayoutPanelLeft, LayoutPanelTop } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { ProtoSessionTabs } from './ProtoSessionTabs';

export function ProtoChatTabsHeader() {
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const chatIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div
      data-testid="proto-chat-tabs-header"
      data-drag-region
      className="flex h-9 shrink-0 items-center border-b border-border pr-1.5 pl-2"
    >
      <GripHorizontal size={13} className="shrink-0 cursor-grab text-muted-foreground" />
      <ProtoSessionTabs surface="chatheader" />
      {splitAvailable && (
        <>
          <Hint label="Split right">
            <Button variant="ghost" size="icon-xs" onClick={() => splitSurface('v')}>
              <LayoutPanelLeft className="text-muted-foreground" />
            </Button>
          </Hint>
          <Hint label="Split down">
            <Button variant="ghost" size="icon-xs" onClick={() => splitSurface('h')}>
              <LayoutPanelTop className="text-muted-foreground" />
            </Button>
          </Hint>
        </>
      )}
      <Hint label={chatIsFloor ? 'Chat is the only surface left' : 'Hide Chat'}>
        <Button variant="ghost" size="icon-xs" disabled={chatIsFloor} onClick={() => toggleSurface('chat')}>
          <EyeOff className="text-muted-foreground" />
        </Button>
      </Hint>
    </div>
  );
}
