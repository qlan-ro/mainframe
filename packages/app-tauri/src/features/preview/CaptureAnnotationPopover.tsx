import type { Capture } from '@/store/sandbox';

interface CaptureAnnotationPopoverProps {
  captures: Capture[];
  onAnnotationChange: (id: string, annotation: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}

export function CaptureAnnotationPopover({
  captures,
  onAnnotationChange,
  onSubmit,
  onCancel,
}: CaptureAnnotationPopoverProps) {
  return (
    <div
      data-testid="preview-annotation-popover"
      className="fixed bottom-4 right-4 z-50 w-80 flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <h3 className="text-heading font-medium text-foreground">Add annotations</h3>
      <ul data-testid="preview-annotation-list" className="flex flex-col gap-2">
        {captures.map((capture) => (
          <li key={capture.id} data-testid={`preview-annotation-item-${capture.id}`} className="flex flex-col gap-1">
            <img
              src={capture.imageDataUrl}
              alt={capture.selector ?? 'screenshot'}
              className="w-full rounded border border-border object-contain"
              style={{ maxHeight: 80 }}
            />
            {capture.selector && (
              <span className="text-caption text-muted-foreground">{capture.selector}</span>
            )}
            <textarea
              data-testid={`preview-annotation-input-${capture.id}`}
              className="w-full rounded border border-border bg-card p-1 text-caption text-body resize-none"
              rows={2}
              placeholder="Add a note..."
              defaultValue={capture.annotation ?? ''}
              onChange={(e) => onAnnotationChange(capture.id, e.target.value)}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2 justify-end">
        <button
          data-testid="preview-annotation-cancel"
          className="rounded px-3 py-1 text-caption text-body border border-border"
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          data-testid="preview-annotation-submit"
          className="rounded bg-blue-500 px-3 py-1 text-caption text-white"
          type="button"
          onClick={() => { void onSubmit(); }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
