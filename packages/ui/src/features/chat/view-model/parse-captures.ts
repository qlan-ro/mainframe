/**
 * Parse side of the sandbox-capture encoding (port of desktop's
 * lib/format-captures.ts parse functions).
 *
 * A capture message's text starts with the \0 sentinel followed by a
 * `> **Preview captures**` blockquote; each row names an attached image
 * (element1.png / screenshot1.png) with an optional selector + annotation.
 * The syntax itself lives in `features/chat/markers/message-markers.ts`
 * alongside every other hidden-from-the-reader block.
 * Render-only in app-tauri — the capture COMPOSER stays gated on the
 * sandbox surface (see docs/architecture/MIGRATION-TRACKER.md). The format
 * side (`formatCaptures`) is deliberately NOT ported.
 */
import { CAPTURE_ROW_RE, splitSandboxCaptureBlock } from '../markers/message-markers';

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
  const block = splitSandboxCaptureBlock(text);
  if (!block) return null;
  const rows = block.rowLines.map((line) => {
    // Non-null: the splitter only collects lines this pattern already matched.
    const m = CAPTURE_ROW_RE.exec(line)!;
    const row: CaptureRow = { label: m[1]!, imageName: `${m[1]!}.png` };
    if (m[2]) row.selector = m[2];
    if (m[3]) row.annotation = m[3];
    return row;
  });
  return { rows, rest: block.rest };
}
