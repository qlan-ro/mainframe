/**
 * SessionPanelToggle — a chat column's "session details" switch. Each column
 * owns one, in its `ChatColumnHeader` — the single chat surface and each zone
 * of a split — so the two halves of a split open
 * and close their panels independently. Pressed = that column's panel is
 * showing (docked, or floated on a narrow column); the
 * click goes through `panel-control-store.togglePanel`, which carries the
 * float-when-narrow rule and reads the column's measured `fits`.
 */
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import {
  selectFits,
  selectOverlayOpen,
  usePanelControl,
  usePanelOpen,
  type PanelColumnId,
} from './panel-control-store';

interface SessionPanelToggleProps {
  columnId: PanelColumnId;
  testId: string;
  /** The tour's `session-rail` anchor — set on the single surface's toggle only. */
  tourAnchor?: boolean;
  className?: string;
}

export function SessionPanelToggle({ columnId, testId, tourAnchor = false, className }: SessionPanelToggleProps) {
  const open = usePanelOpen(columnId);
  const fits = usePanelControl(selectFits(columnId));
  const floating = usePanelControl(selectOverlayOpen(columnId));
  const togglePanel = usePanelControl((s) => s.togglePanel);
  // Pressed = the panel is SHOWING (docked, or floated on a narrow column) —
  // not merely the open bit, which a narrow column honours by showing nothing.
  const showing = open && (fits || floating);
  const label = showing ? 'Hide session details' : 'Show session details';

  return (
    <Hint label={label}>
      <Button
        data-testid={testId}
        data-tut={tourAnchor ? 'session-rail' : undefined}
        aria-label={label}
        aria-pressed={showing}
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          // A zone's strip focuses its zone on pointerdown; the toggle must not
          // also bubble into anything that treats a click as "activate".
          event.stopPropagation();
          togglePanel(columnId, fits);
        }}
        className={cn('text-muted-foreground', showing && 'bg-accent text-foreground', className)}
      >
        <PanelRight className="size-4" />
      </Button>
    </Hint>
  );
}
