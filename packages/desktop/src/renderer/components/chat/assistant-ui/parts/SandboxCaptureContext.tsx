import { SelectorBreadcrumb } from './SelectorBreadcrumb.js';
import type { CaptureRow } from '../../../../lib/format-captures.js';

export function SandboxCaptureContext({ rows }: { rows: ReadonlyArray<CaptureRow> }) {
  const visible = rows.filter((r) => r.selector || r.annotation);
  if (visible.length === 0) return null;
  return (
    <ul data-testid="sandbox-capture-context" className="flex flex-col gap-1.5 w-fit max-w-full">
      {visible.map((r) => (
        <li
          key={r.label}
          data-testid="capture-meta-row"
          className="flex flex-col gap-0.5 min-w-0 text-mf-small text-mf-text-secondary"
        >
          {r.selector ? <SelectorBreadcrumb path={r.selector} /> : null}
          {r.annotation ? <span className="truncate">{r.annotation}</span> : null}
        </li>
      ))}
    </ul>
  );
}
