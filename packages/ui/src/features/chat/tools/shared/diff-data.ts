import { structuredPatch } from 'diff';
import { StructuredDiffSchema, type DiffHunk } from '@qlan-ro/mainframe-types';

export function countDiffStats(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line[0] === '+') added++;
      else if (line[0] === '-') removed++;
    }
  }
  return { added, removed };
}

/** Both sides of an edit as far as its hunks show them. */
export function reconstructFromHunks(hunks: DiffHunk[]): { original: string; modified: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const prefix = line[0] ?? ' ';
      const content = line.slice(1);
      if (prefix === '-') oldLines.push(content);
      else if (prefix === '+') newLines.push(content);
      else {
        oldLines.push(content);
        newLines.push(content);
      }
    }
  }
  return { original: oldLines.join('\n'), modified: newLines.join('\n') };
}

export function computeFallbackHunks(oldStr: string, newStr: string): DiffHunk[] {
  const patch = structuredPatch('', '', oldStr, newStr, '', '', { context: 3 });
  return patch.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));
}

export function resolveToolDiff(
  kind: 'Edit' | 'Write',
  args: unknown,
  result: unknown,
): {
  hunks: DiffHunk[] | null;
  stats: { added: number; removed: number } | null;
} {
  const parsed = StructuredDiffSchema.safeParse(result);
  const structured =
    parsed.success && parsed.data.structuredPatch.every(validHunk) ? parsed.data.structuredPatch : null;
  const hunks = structured ?? (kind === 'Edit' ? editFallback(args) : null);
  return { hunks, stats: hunks ? countDiffStats(hunks) : null };
}

function editFallback(args: unknown): DiffHunk[] | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  const { old_string: oldString, new_string: newString } = args as Record<string, unknown>;
  if (typeof oldString !== 'string' || typeof newString !== 'string' || (!oldString && !newString)) return null;
  return computeFallbackHunks(oldString, newString);
}

function validHunk(hunk: DiffHunk): boolean {
  return (
    [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every((value) => value >= 0) &&
    hunk.lines.every((line) => /^[ +\-]/.test(line) || line === '\\ No newline at end of file')
  );
}
