/**
 * The "New session" action, on the first group header — ONE CLICK, always.
 *
 * With a project filter active the target is known and the button opens that
 * project's draft; without one it opens the projectless draft and the welcome
 * screen's own picker resolves the project (the old anchored "NEW SESSION IN…"
 * popover is gone). Re-clicking retargets the single reused draft rather than
 * stacking a second one.
 */
import { PlusIcon } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { resetNewThreadDraft } from './new-thread/reset-new-thread-draft';
import { useOpenDraft } from './use-open-draft';

interface SessionsNewButtonProps {
  filterProjectId: string | null;
  filterProjectName: string | null;
}

export function SessionsNewButton({ filterProjectId, filterProjectName }: SessionsNewButtonProps) {
  const aui = useAui();
  const openDraft = useOpenDraft();

  const open = () => {
    if (filterProjectId != null) {
      void openDraft({ projectId: filterProjectId });
      return;
    }
    resetNewThreadDraft(aui.threads.getState().newThreadId);
    void aui.threads.switchToNewThread();
  };

  const label = filterProjectName != null ? `New session in ${filterProjectName}` : 'New session';
  return (
    <Hint label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="sessions-new-button"
        // TutorialOverlay's first step anchors here; without it the step is
        // unanchorable and the auto-skip drops "Start a session" entirely.
        data-tut="sessions"
        aria-label={label}
        className="size-6"
        onClick={open}
      >
        <PlusIcon />
      </Button>
    </Hint>
  );
}
