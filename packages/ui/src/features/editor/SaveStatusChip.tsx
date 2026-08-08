import { Badge } from '@/components/ui/badge';

/**
 * Save-status chip shown in the ViewerShell header actions slot.
 *
 * The hue rides the dot, not the label — a two-word status reads as ink at
 * 11px, and the v2 chip recipe is a neutral `secondary` Badge.
 */
export function SaveStatusChip({ dirty }: { dirty: boolean }) {
  return (
    <Badge data-testid="editor-save-status" variant="secondary">
      <span className={dirty ? 'size-1.5 rounded-full bg-warning' : 'size-1.5 rounded-full bg-success'} aria-hidden />
      {dirty ? 'unsaved' : 'saved'}
    </Badge>
  );
}
