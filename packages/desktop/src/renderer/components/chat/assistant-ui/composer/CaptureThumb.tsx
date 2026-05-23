import { X } from 'lucide-react';

export function CaptureThumb({
  label,
  imageUrl,
  onRemove,
}: {
  label: string;
  imageUrl: string | undefined;
  onRemove: () => void;
}) {
  return (
    <div data-testid="capture-thumb" className="relative group flex flex-col items-center gap-1 w-14">
      <div className="relative w-14 h-14">
        <img src={imageUrl} alt={label} className="w-full h-full rounded object-cover border border-mf-border" />
        <button
          type="button"
          data-testid="capture-thumb-remove"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-4 h-4 bg-mf-text-primary rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={10} className="text-mf-panel-bg" />
        </button>
      </div>
      <span
        data-testid="capture-thumb-name"
        className="text-[10px] font-mono text-mf-text-secondary truncate max-w-full"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}
