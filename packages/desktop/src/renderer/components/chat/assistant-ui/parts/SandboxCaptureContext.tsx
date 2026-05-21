import { SelectorBreadcrumb } from './SelectorBreadcrumb.js';
import type { CaptureRow } from '../../../../lib/format-captures.js';
import { captureColor } from '../../../../lib/capture-colors.js';

export function SandboxCaptureContext({ rows }: { rows: ReadonlyArray<CaptureRow> }) {
  // Preserve the original index so per-capture colors stay stable even when a row
  // with no selector/annotation is filtered out before render.
  const visible = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.selector || row.annotation);
  if (visible.length === 0) return null;
  return (
    <ul data-testid="sandbox-capture-context" className="flex flex-col gap-1.5 w-fit max-w-full">
      {visible.map(({ row: r, index }) => {
        const color = captureColor(index);
        return (
          <li
            key={r.label}
            data-testid="capture-meta-row"
            className="flex flex-col gap-0.5 min-w-0 text-mf-small text-mf-text-secondary"
          >
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span
                data-testid="capture-row-label"
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border shrink-0 ${color.badge}`}
              >
                {r.label}
              </span>
              {r.selector ? <SelectorBreadcrumb path={r.selector} /> : null}
            </div>
            {r.annotation ? <span className="truncate pl-1">{r.annotation}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
