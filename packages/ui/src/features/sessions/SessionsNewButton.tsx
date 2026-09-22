/**
 * The "New session" action, on the first group header — ONE CLICK, always.
 *
 * Target resolution (pill → active session's project → none) is shared with
 * every other "+" entry point via useStartNewSession; without a target the
 * welcome screen's own picker resolves the project (the old anchored "NEW
 * SESSION IN…" popover is gone). Re-clicking retargets the single reused
 * draft rather than stacking a second one.
 */
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useStartNewSession } from './new-thread/use-start-new-session';

interface SessionsNewButtonProps {
  filterProjectName: string | null;
}

export function SessionsNewButton({ filterProjectName }: SessionsNewButtonProps) {
  const startNewSession = useStartNewSession();

  const label = filterProjectName != null ? `New session in ${filterProjectName}` : 'New session';
  return (
    <Hint label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="sessions-new-button"
        // TutorialOverlay's first step anchors here; without it the step is
        // unanchorable and the auto-skip drops "Start a session" entirely.
        data-tut="new-session"
        aria-label={label}
        className="size-6"
        onClick={startNewSession}
      >
        <PlusIcon />
      </Button>
    </Hint>
  );
}
