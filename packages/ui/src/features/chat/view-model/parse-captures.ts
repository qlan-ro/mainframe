/**
 * Parse side of the sandbox-capture encoding (port of desktop's
 * lib/format-captures.ts parse functions).
 *
 * A capture message's text starts with the \0 sentinel followed by a
 * `> **Preview captures**` blockquote; each row names an attached image
 * (element1.png / screenshot1.png) with an optional selector + annotation.
 * Render-only in app-tauri — the capture COMPOSER stays gated on the
 * sandbox surface (see docs/architecture/MIGRATION-TRACKER.md). The format
 * side (`formatCaptures`) is deliberately NOT ported.
 */
export const SANDBOX_CAPTURE_SENTINEL = '\0__MF_SANDBOX_CAPTURE__';

export interface CaptureRow {
  label: string;
  imageName: string;
  selector?: string;
  annotation?: string;
}

/**
 * null ONLY when the sentinel is absent. After a sentinel match, malformed
 * lines stop row-parsing and everything remaining lands in `rest` (possibly
 * zero rows) — desktop semantics, the sentinel itself is always stripped.
 */
export function parseSandboxCaptureBlock(text: string): { rows: CaptureRow[]; rest: string } | null {
  if (!text.startsWith(SANDBOX_CAPTURE_SENTINEL)) return null;
  const body = text.slice(SANDBOX_CAPTURE_SENTINEL.length).replace(/^\n/, '');
  const all = body.split('\n');
  const rows: CaptureRow[] = [];
  let i = 0;
  if (all[i]?.trim() === '> **Preview captures**') i += 1;
  for (; i < all.length; i++) {
    const line = all[i] ?? '';
    const m = line.match(/^> - `([^`]+)`(?: — selector `([^`]+)`)?(?: — "(.*)")?$/);
    if (!m) break;
    const row: CaptureRow = { label: m[1]!, imageName: `${m[1]!}.png` };
    if (m[2]) row.selector = m[2];
    if (m[3]) row.annotation = m[3];
    rows.push(row);
  }
  const rest = all.slice(i).join('\n').trim();
  return { rows, rest };
}
