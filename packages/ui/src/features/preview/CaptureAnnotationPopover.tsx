import type { Capture } from '@/store/sandbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface CaptureAnnotationPopoverProps {
  captures: Capture[];
  onAnnotationChange: (id: string, annotation: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Floating popover for annotating sandbox captures before sending.
 *
 * No artboard exists yet — this is a token/primitive cleanup pass: warm-chrome
 * popover shadow (`--mf-shadow-pop`) + the shared `Button`/`Textarea` primitives
 * (which carry the focus/hover/disabled states) rather than bare elements.
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
      className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-[var(--mf-shadow-pop)]"
    >
      <h3 className="text-heading font-medium text-foreground">Add annotations</h3>
      <ul data-testid="preview-annotation-list" className="flex flex-col gap-2">
        {captures.map((capture) => (
          <li key={capture.id} data-testid={`preview-annotation-item-${capture.id}`} className="flex flex-col gap-1">
            <img
              src={capture.imageDataUrl}
              alt={capture.selector ?? 'screenshot'}
              className="w-full rounded-md border border-border object-contain"
              style={{ maxHeight: 80 }}
            />
            {capture.selector && <span className="text-label text-muted-foreground">{capture.selector}</span>}
            <Textarea
              data-testid={`preview-annotation-input-${capture.id}`}
              className="min-h-[44px] px-2 py-1.5 text-body"
              rows={2}
              placeholder="Add a note..."
              defaultValue={capture.annotation ?? ''}
              onChange={(e) => onAnnotationChange(capture.id, e.target.value)}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button data-testid="preview-annotation-cancel" type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          data-testid="preview-annotation-submit"
          type="button"
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
