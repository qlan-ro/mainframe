import React from 'react';
import { structuredPatch } from 'diff';
import type { DiffHunk } from '@mainframe/types';
export function stripErrorXml(text: string): string {
  return text.replace(/<\/?(?:tool_use_error|error)>/g, '').trim();
}

export interface ToolResult {
  content: string;
  structuredPatch: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
}

export function isStructuredResult(result: unknown): result is ToolResult {
  return typeof result === 'object' && result !== null && 'structuredPatch' in result;
}

export function StatusDot({ result, isError }: { result: unknown; isError: boolean | undefined }) {
  if (result === undefined) {
    return <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse shrink-0" />;
  }
  if (isError) {
    return <span className="w-2 h-2 rounded-full bg-mf-chat-error shrink-0" />;
  }
  return <span className="w-2 h-2 rounded-full bg-mf-success shrink-0" />;
}

export function ErrorDot({ isError }: { isError: boolean | undefined }) {
  if (!isError) return null;
  return <span className="w-2 h-2 rounded-full bg-mf-chat-error shrink-0" />;
}

export function borderColor(result: unknown, isError: boolean | undefined): string {
  if (result === undefined) return 'border-l-mf-divider';
  if (isError) return 'border-l-mf-chat-error';
  return 'border-l-mf-chat-diff-added';
}

export function cardStyle(result: unknown, isError: boolean | undefined): string {
  if (isError && result !== undefined)
    return 'border border-mf-chat-error/30 rounded-mf-card bg-mf-input-bg/40 overflow-hidden';
  return 'rounded-mf-card bg-mf-input-bg/40 overflow-hidden';
}

export function shortFilename(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : filePath;
}

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
      const prefix = line[0] || ' ';
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

function countOldLines(lines: string[], upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo; i++) {
    if (lines[i]![0] !== '+') count++;
  }
  return count;
}

function countNewLines(lines: string[], upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo; i++) {
    if (lines[i]![0] !== '-') count++;
  }
  return count;
}

export function DiffFromPatch({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="font-mono text-mf-small leading-[20px] overflow-x-auto">
      {hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          {hi > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 select-none">
              <div className="flex-1 h-px bg-mf-divider" />
              <span className="text-mf-text-secondary opacity-30 text-[11px]">···</span>
              <div className="flex-1 h-px bg-mf-divider" />
            </div>
          )}
          {hunk.lines.map((line, li) => {
            const prefix = line[0] || ' ';
            const content = line.slice(1);
            const oldLineNum = hunk.oldStart + countOldLines(hunk.lines, li);
            const newLineNum = hunk.newStart + countNewLines(hunk.lines, li);

            if (prefix === '+') {
              return (
                <div
                  key={`${hi}-${li}`}
                  className="flex border-l-2 border-l-mf-chat-diff-added bg-mf-chat-diff-added/[8%] hover:bg-mf-chat-diff-added/[13%] transition-colors"
                >
                  <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-1"> </span>
                  <span className="shrink-0 w-8 select-none text-mf-chat-diff-added-text opacity-70 text-right pr-2">
                    {newLineNum}
                  </span>
                  <span className="shrink-0 w-5 select-none text-mf-chat-diff-added-text text-center">+</span>
                  <span className="text-mf-chat-diff-added-content whitespace-pre-wrap break-all pr-3">{content}</span>
                </div>
              );
            }
            if (prefix === '-') {
              return (
                <div
                  key={`${hi}-${li}`}
                  className="flex border-l-2 border-l-mf-chat-diff-removed bg-mf-chat-diff-removed/[8%] hover:bg-mf-chat-diff-removed/[13%] transition-colors"
                >
                  <span className="shrink-0 w-8 select-none text-mf-chat-diff-removed-text opacity-70 text-right pr-1">
                    {oldLineNum}
                  </span>
                  <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-2"> </span>
                  <span className="shrink-0 w-5 select-none text-mf-chat-diff-removed-text text-center">-</span>
                  <span className="text-mf-chat-diff-removed-content whitespace-pre-wrap break-all pr-3">
                    {content}
                  </span>
                </div>
              );
            }
            return (
              <div
                key={`${hi}-${li}`}
                className="flex border-l-2 border-l-transparent hover:bg-mf-text-primary/5 transition-colors"
              >
                <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-1">
                  {oldLineNum}
                </span>
                <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-2">
                  {newLineNum}
                </span>
                <span className="shrink-0 w-5 select-none text-mf-text-secondary opacity-30 text-center"> </span>
                <span className="text-mf-text-secondary whitespace-pre-wrap break-all pr-3">{content}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

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
    <div className="font-mono text-mf-small leading-[20px] overflow-x-auto">
      {oldLines.map((line, i) => (
        <div
          key={`old-${i}`}
          className="flex border-l-2 border-l-mf-chat-diff-removed bg-mf-chat-diff-removed/[8%] hover:bg-mf-chat-diff-removed/[13%] transition-colors"
        >
          <span className="shrink-0 w-8 select-none text-mf-chat-diff-removed-text opacity-70 text-right pr-1">
            {hasLineNums ? startLine + i : ''}
          </span>
          <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-2"> </span>
          <span className="shrink-0 w-5 select-none text-mf-chat-diff-removed-text text-center">-</span>
          <span className="text-mf-chat-diff-removed-content whitespace-pre-wrap break-all pr-3">{line}</span>
        </div>
      ))}
      {oldLines.length > 0 && newLines.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-0.5 select-none">
          <div className="flex-1 h-px bg-mf-divider" />
        </div>
      )}
      {newLines.map((line, i) => (
        <div
          key={`new-${i}`}
          className="flex border-l-2 border-l-mf-chat-diff-added bg-mf-chat-diff-added/[8%] hover:bg-mf-chat-diff-added/[13%] transition-colors"
        >
          <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-1"> </span>
          <span className="shrink-0 w-8 select-none text-mf-chat-diff-added-text opacity-70 text-right pr-2">
            {hasLineNums ? startLine + i : ''}
          </span>
          <span className="shrink-0 w-5 select-none text-mf-chat-diff-added-text text-center">+</span>
          <span className="text-mf-chat-diff-added-content whitespace-pre-wrap break-all pr-3">{line}</span>
        </div>
      ))}
    </div>
  );
}

export interface ToolCardProps {
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
}
