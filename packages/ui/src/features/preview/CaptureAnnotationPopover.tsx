import type { Capture } from '@/store/sandbox';
import { Button } from '@v2/components/ui/button';
import { Textarea } from '@v2/components/ui/textarea';

interface CaptureAnnotationPopoverProps {
  captures: Capture[];
  onAnnotationChange: (id: string, annotation: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Floating panel for annotating sandbox captures before sending.
 *
 * A form, so it stays a plain panel rather than a menu: it is pinned to the
 * preview's bottom-right with no trigger, and Radix menus never hold inputs.
 * Chrome matches the v2 popover surface (bg-popover, shadow-md, hairline ring).
 */
export function CaptureAnnotationPopover({
  captures,
  onAnnotationChange,
  onSubmit,
  onCancel,
}: CaptureAnnotationPopoverProps) {
  return (
    <div
      data-testid="preview-annotation-popover"
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-3 rounded-md bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <h3 className="text-sm font-medium">Add annotations</h3>
      <ul data-testid="preview-annotation-list" className="flex flex-col gap-2">
        {captures.map((capture) => (
          <li key={capture.id} data-testid={`preview-annotation-item-${capture.id}`} className="flex flex-col gap-1">
            <img
              src={capture.imageDataUrl}
              alt={capture.selector ?? 'screenshot'}
              className="max-h-20 w-full rounded-md border border-border object-contain"
            />
            {capture.selector && <span className="text-xs text-muted-foreground">{capture.selector}</span>}
            <Textarea
              data-testid={`preview-annotation-input-${capture.id}`}
              className="min-h-11 px-2 py-1.5"
              rows={2}
              placeholder="Add a note..."
              defaultValue={capture.annotation ?? ''}
              onChange={(e) => onAnnotationChange(capture.id, e.target.value)}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button data-testid="preview-annotation-cancel" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          data-testid="preview-annotation-submit"
          size="sm"
          onClick={() => {
            void onSubmit();
          }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
