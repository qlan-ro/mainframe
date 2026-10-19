import { useLayoutEffect } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TurnDisclosure } from '../../view-model/compact/turn-types';
import { useTurnPresentationActions, useTurnPresentationSelector } from './turn-presentation-context';
import { useCompactScrollAnchor } from './use-compact-scroll-anchor';
import { turnDisclosureStore } from './turn-disclosure-store';
import { CompactTurnElapsed } from './CompactTurnElapsed';

export const workSlotId = (key: string) => `chat-work-slot-${encodeURIComponent(key)}`;
export function CompactTurnDisclosure({ turn }: { turn: TurnDisclosure }) {
  const { toggle, register } = useTurnPresentationActions();
  const open = useTurnPresentationSelector((s) => s.open(turn.key));
  const { rowRef, beforeToggle } = useCompactScrollAnchor(open);
  useLayoutEffect(() => register(turn.key, beforeToggle), [register, turn.key, beforeToggle]);
  return (
    <div ref={rowRef} className="min-w-0 py-1">
      <Button
        variant="ghost"
        size="sm"
        data-testid={`chat-work-toggle-${encodeURIComponent(turn.key)}`}
        // A static name: the elapsed text is empty while the turn runs and the chevron is aria-hidden.
        aria-label="Work details"
        aria-expanded={open}
        aria-controls={turn.workKeys.map(workSlotId).join(' ')}
        disabled={turn.unsafe || turnDisclosureStore.isInvalid(turn.key)}
        onClick={() => toggle(turn.key)}
        className="gap-2 text-muted-foreground"
      >
        <ChevronRightIcon aria-hidden className={`size-3 shrink-0 ${open ? 'rotate-90' : ''}`} />
        <CompactTurnElapsed turn={turn} />
      </Button>
    </div>
  );
}
