export interface LineCommentInput {
  startLine: number;
  endLine: number;
  lineContent: string;
  comment: string;
}

function fenceFor(content: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
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

export function formatReview(filePath: string, items: LineCommentInput[]): string {
  return `File: \`${filePath}\`\n\n${items.map(formatLineComment).join('\n\n---\n\n')}`;
}
