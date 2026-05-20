import { SelectorBreadcrumb } from './SelectorBreadcrumb.js';
import type { CaptureRow } from '../../../../lib/format-captures.js';

export function SandboxCaptureContext({ rows }: { rows: ReadonlyArray<CaptureRow> }) {
  const visible = rows.filter((r) => r.selector || r.annotation);
  if (visible.length === 0) return null;
  return (
    <ul data-testid="sandbox-capture-context" className="flex flex-col gap-1.5 max-w-[75%] w-fit">
      {visible.map((r) => (
        <li
          key={r.label}
          data-testid="capture-meta-row"
          className="flex items-start gap-2 text-mf-small text-mf-text-secondary"
        >
          <span className="font-mono text-[11px] shrink-0 mt-0.5">{r.label}</span>
          <div className="flex flex-col gap-0.5 min-w-0">
            {r.selector ? <SelectorBreadcrumb path={r.selector} /> : null}
            {r.annotation ? <span className="truncate">{r.annotation}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
