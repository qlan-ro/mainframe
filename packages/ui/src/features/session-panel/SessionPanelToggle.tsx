/**
 * SessionPanelToggle — the title bar's "session details" switch, the panel's
 * ONLY switch now that the floating rail is gone. Pressed = the persisted open
 * bit; the click goes through `panel-control-store.togglePanel` for the
 * FOCUSED chat column (the single surface, or the focused zone of a visible
 * split), which carries the float-when-narrow rule and reads that column's
 * measured `fits`.
 *
 * Carries the tour's `session-rail` anchor — the step that used to point at
 * the rail points here.
 */
import { PanelRight } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useUiPrefs } from '@/store/ui-prefs';
import { splitVisible, useZonesStore } from '@/features/chat/zones/zones-store';
import { selectFits, usePanelControl, zoneColumnId, type PanelColumnId } from './panel-control-store';

/** The column whose panel the toggle drives: a zone while its split is on screen, else the main surface. */
export function focusedPanelColumn(
  zones: [string, string] | null,
  mainThreadId: string | null,
  fits = true,
): PanelColumnId {
  return mainThreadId != null && splitVisible(zones, mainThreadId, fits) ? zoneColumnId(mainThreadId) : 'main';
}

export function SessionPanelToggle() {
  const zones = useZonesStore((s) => s.zones);
  const splitFits = useZonesStore((s) => s.splitFits);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const columnId = focusedPanelColumn(zones, mainThreadId, splitFits);
  const open = useUiPrefs((s) => s.sessionPanelOpen);
  const fits = usePanelControl(selectFits(columnId));
  const togglePanel = usePanelControl((s) => s.togglePanel);
  const label = open ? 'Hide session details' : 'Show session details';

  return (
    <Hint label={label}>
      <Button
        data-testid="title-bar-details"
        data-tut="session-rail"
        aria-label={label}
        aria-pressed={open}
        variant="ghost"
        size="icon-sm"
        onClick={() => togglePanel(columnId, fits)}
        className={cn('text-muted-foreground', open && 'bg-accent text-foreground')}
      >
        <PanelRight className="size-4" />
      </Button>
    </Hint>
  );
}
