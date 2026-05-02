import type { DiffHunk } from '@qlan-ro/mainframe-types';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified-diff string into an array of DiffHunk objects.
 *
 * Each `@@ -<oldStart>[,<oldLines>] +<newStart>[,<newLines>] @@` header starts
 * a new hunk. Lines following a header (until the next header or EOF) are the
 * hunk's `lines`, with their leading `+`/`-`/` ` character preserved.
 *
 * If the input contains no hunk headers (e.g. a bare `+foo\n-bar`), all lines
 * are collected into a single hunk with `oldStart=1, newStart=1`.
 */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  if (!diff || !diff.trim()) {
    return [];
  }

  const rawLines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of rawLines) {
    const match = HUNK_HEADER_RE.exec(line);
    if (match) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(match[1]!, 10),
        oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3]!, 10),
        newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Headerless diff — lazily create a default hunk on first content line
      current = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: [line] };
    }
  }

  if (current) hunks.push(current);

  return hunks;
}
