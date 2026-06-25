/**
 * Format a line/range comment from the diff editor for posting back into the
 * chat as a markdown message. The line content is fenced verbatim; if it
 * already contains a backtick run, the fence is grown to one backtick longer
 * than the longest run inside the content so the fence cannot be closed
 * prematurely (which would otherwise let arbitrary code escape the quote).
 */
export interface LineCommentInput {
  startLine: number;
  endLine: number;
  lineContent: string;
  comment: string;
}

function fenceFor(content: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longestRun + 1));
}

export function formatLineComment(item: LineCommentInput): string {
  const lineRef =
    item.startLine === item.endLine ? `line ${item.startLine}` : `lines ${item.startLine}-${item.endLine}`;
  const trimmed = item.lineContent.trim();
  const fence = fenceFor(trimmed);
  const quote = trimmed ? `\n${fence}\n${trimmed}\n${fence}` : '';
  return `At ${lineRef}:${quote}\n${item.comment}`;
}
