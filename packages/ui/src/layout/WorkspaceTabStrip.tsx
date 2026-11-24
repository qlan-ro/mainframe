/**
 * WorkspaceTabStrip — a second workspace pane's own header row: its tabs, the
 * `+` and the un-split button. The primary pane's tabs are in the title bar
 * (`TitleBarWorkspace`), so it has no strip.
 *
 * data-testid: workspace-pane-close-<paneId> un-splits.
 */
import { LayoutPanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useLayoutStore } from '@/store/layout';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { RunPane } from '@/store/run-pane';

export function WorkspaceTabStrip({ pane }: { pane: RunPane }) {
  const closePane = useLayoutStore((s) => s.closePane);
  return (
    <div className="flex h-11 shrink-0 items-center pr-1.5 pl-2">
      <WorkspaceTabs pane={pane} />
      <div className="flex-1" />
      <Hint label="Close pane (un-split)">
        <Button
          data-testid={`workspace-pane-close-${pane.id}`}
          aria-label="Close pane"
          variant="ghost"
          size="icon-xs"
          onClick={() => closePane(pane.id)}
        >
          <LayoutPanelLeft className="text-muted-foreground" />
        </Button>
      </Hint>
    </div>
  );
}
