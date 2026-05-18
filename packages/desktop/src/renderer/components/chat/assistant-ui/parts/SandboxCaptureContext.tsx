import { SelectorBreadcrumb } from './SelectorBreadcrumb.js';
import type { CaptureRow } from '../../../../lib/format-captures.js';

export function SandboxCaptureContext({
  rows,
  images,
  onRemove,
}: {
  rows: CaptureRow[];
  images: Record<string, string>;
  onRemove?: (label: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul data-testid="sandbox-capture-context" className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
          {images[r.imageName] ? (
            <img
              src={images[r.imageName]}
              alt={r.label}
              className="w-10 h-10 rounded object-cover border border-mf-border shrink-0"
            />
          ) : null}
          <div className="flex flex-col gap-0.5 min-w-0">
            {r.selector ? (
              <SelectorBreadcrumb path={r.selector} />
            ) : (
              <span className="font-mono text-[11px]">{r.label}</span>
            )}
            {r.annotation ? <span className="truncate">{r.annotation}</span> : null}
          </div>
          {onRemove ? (
            <button
              type="button"
              data-testid="capture-remove"
              aria-label={`Remove ${r.label}`}
              onClick={() => onRemove(r.label)}
              className="ml-auto shrink-0 text-mf-text-secondary hover:text-mf-text-primary"
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
