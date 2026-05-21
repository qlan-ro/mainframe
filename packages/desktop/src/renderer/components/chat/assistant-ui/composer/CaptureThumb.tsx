import { X } from 'lucide-react';
import { captureColor } from '../../../../lib/capture-colors.js';

export function CaptureThumb({
  label,
  imageUrl,
  index,
  onRemove,
}: {
  label: string;
  imageUrl: string | undefined;
  index: number;
  onRemove: () => void;
}) {
  const color = captureColor(index);
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
        className={`text-[10px] font-mono truncate max-w-full ${color.caption}`}
        title={label}
      >
        {label}
      </span>
    </div>
  );
}
