/**
 * Diff rendering primitives — DiffFromPatch, DiffFallback, and the pure math
 * helpers (countDiffStats, reconstructFromHunks, computeFallbackHunks).
 *
 * Token map (desktop → app-tauri warm-chrome):
 *   bg-mf-chat-diff-added/[8%]  → bg-mf-diff-add-bg   (opaque pre-tinted hex)
 *   bg-mf-chat-diff-removed/[8%] → bg-mf-diff-del-bg
 *   border-l-mf-chat-diff-added  → border-l-mf-diff-add-border
 *   border-l-mf-chat-diff-removed → border-l-mf-diff-del-border
 *   text-mf-chat-diff-added-text → text-mf-diff-add-text
 *   text-mf-chat-diff-removed-text → text-mf-diff-del-text
 *   text-mf-text-secondary        → text-muted-foreground
 *   text-mf-small                 → text-caption
 *   bg-mf-divider / h-px          → border-border
 *
 * No /opacity modifier is used on any --mf-* var (CSS-var hex trap).
 */
import React from 'react';
import { structuredPatch } from 'diff';
import type { DiffHunk } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Pure math helpers (no React)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal line-counting helpers
// ---------------------------------------------------------------------------

function countOldLines(lines: string[], upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo; i++) {
    if (lines[i]?.[0] !== '+') count++;
  }
  return count;
}

function countNewLines(lines: string[], upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo; i++) {
    if (lines[i]?.[0] !== '-') count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// DiffLineRow — shared row renderer (add / del / context)
// ---------------------------------------------------------------------------

type LineKind = 'add' | 'del' | 'ctx';

interface DiffLineRowProps {
  kind: LineKind;
  content: string;
  oldNum?: number | string;
  newNum?: number | string;
  rowKey: string;
}

function DiffLineRow({ kind, content, oldNum = '', newNum = '', rowKey }: DiffLineRowProps) {
  const addRow = cn(
    'flex border-l-2 border-l-mf-diff-add-border bg-mf-diff-add-bg',
    'hover:brightness-95 transition-colors',
  );
  const delRow = cn(
    'flex border-l-2 border-l-mf-diff-del-border bg-mf-diff-del-bg',
    'hover:brightness-95 transition-colors',
  );
  const ctxRow = cn('flex border-l-2 border-l-transparent', 'hover:bg-accent transition-colors');

  const rowClass = kind === 'add' ? addRow : kind === 'del' ? delRow : ctxRow;

  const addSign = <span className="shrink-0 w-5 select-none text-mf-diff-add-text text-center">+</span>;
  const delSign = <span className="shrink-0 w-5 select-none text-mf-diff-del-text text-center">-</span>;
  const ctxSign = <span className="shrink-0 w-5 select-none text-mf-text-3 text-center"> </span>;

  return (
    <div key={rowKey} className={rowClass}>
      {/* old line number */}
      <span className="shrink-0 w-8 select-none text-mf-text-3 text-right pr-1">{kind === 'add' ? '' : oldNum}</span>
      {/* new line number */}
      <span className="shrink-0 w-8 select-none text-mf-text-3 text-right pr-2">{kind === 'del' ? '' : newNum}</span>
      {/* sign column */}
      {kind === 'add' ? addSign : kind === 'del' ? delSign : ctxSign}
      {/* content */}
      <span
        className={cn(
          'select-text whitespace-pre-wrap break-all pr-3',
          kind === 'add' && 'text-mf-diff-add-text',
          kind === 'del' && 'text-mf-diff-del-text',
          kind === 'ctx' && 'text-muted-foreground',
        )}
      >
        {content}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HunkSeparator
// ---------------------------------------------------------------------------

function HunkSeparator() {
  return (
    <div className="flex items-center gap-2 px-3 py-1 select-none">
      <div className="flex-1 h-px bg-border" />
      <span className="text-mf-text-4 text-caption">···</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffFromPatch — renders structured hunks from the daemon's patch payload
// ---------------------------------------------------------------------------

export function DiffFromPatch({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="font-mono text-label leading-5 overflow-x-auto bg-mf-code-bg">
      {hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          {hi > 0 && <HunkSeparator />}
          {hunk.lines.map((line, li) => {
            const prefix = line[0] ?? ' ';
            const content = line.slice(1);
            const oldLineNum = hunk.oldStart + countOldLines(hunk.lines, li);
            const newLineNum = hunk.newStart + countNewLines(hunk.lines, li);
            const rowKey = `${hi}-${li}`;

            if (prefix === '+') {
              return <DiffLineRow key={rowKey} rowKey={rowKey} kind="add" content={content} newNum={newLineNum} />;
            }
            if (prefix === '-') {
              return <DiffLineRow key={rowKey} rowKey={rowKey} kind="del" content={content} oldNum={oldLineNum} />;
            }
            return (
              <DiffLineRow
                key={rowKey}
                rowKey={rowKey}
                kind="ctx"
                content={content}
                oldNum={oldLineNum}
                newNum={newLineNum}
              />
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffFallback — side-by-side old/new when no structured patch is available
// ---------------------------------------------------------------------------

export function DiffFallback({
  oldStr,
  newStr,
  startLine,
}: {
  oldStr: string;
  newStr: string;
  startLine: number | null;
}) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const hasLineNums = startLine !== null;

  return (
    <div className="font-mono text-label leading-5 overflow-x-auto bg-mf-code-bg">
      {oldLines.map((line, i) => (
        <DiffLineRow
          key={`old-${i}`}
          rowKey={`old-${i}`}
          kind="del"
          content={line}
          oldNum={hasLineNums ? (startLine ?? 0) + i : ''}
        />
      ))}
      {oldLines.length > 0 && newLines.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-0.5 select-none">
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      {newLines.map((line, i) => (
        <DiffLineRow
          key={`new-${i}`}
          rowKey={`new-${i}`}
          kind="add"
          content={line}
          newNum={hasLineNums ? (startLine ?? 0) + i : ''}
        />
      ))}
    </div>
  );
}
