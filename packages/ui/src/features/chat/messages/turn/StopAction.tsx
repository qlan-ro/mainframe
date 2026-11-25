/** Stop at the end of a live agent's or delegated task's row (T1c): the panel's glyph, in the row's own action. */
import { useRef } from 'react';
import { Square } from 'lucide-react';
import { useFocusLoss } from '@/features/session-panel/use-row-focus';
import { RowAction } from './RowDisclosure';

interface StopActionProps {
  title: string;
  testId: string;
  stopping: boolean;
  onStop: () => void;
}

export function StopAction({ title, testId, stopping, onStop }: StopActionProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLElement>(null);
  // The work ended with the focus on its Stop: the row it was in keeps it.
  useFocusLoss(ref, () => row.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus({ preventScroll: true }));
  return (
    <RowAction
      ref={(button) => {
        ref.current = button;
        if (button) row.current = button.closest<HTMLElement>('[data-state]');
      }}
      label={stopping ? `Stopping ${title}` : `Stop ${title}`}
      testId={testId}
      busy={stopping}
      onClick={onStop}
    >
      <Square className="size-3! fill-current" />
    </RowAction>
  );
}
