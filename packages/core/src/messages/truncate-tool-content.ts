export const TRUNCATE_THRESHOLD_BYTES = 32 * 1024;
const HEAD_LINES = 100;
const TAIL_LINES = 100;

export interface TruncateResult {
  content: string;
  truncated: boolean;
  fullBytes?: number;
}

export function truncateToolContent(content: string): TruncateResult {
  const fullBytes = Buffer.byteLength(content, 'utf8');
  if (fullBytes <= TRUNCATE_THRESHOLD_BYTES) {
    return { content, truncated: false };
  }
  const lines = content.split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES) {
    const head = content.slice(0, TRUNCATE_THRESHOLD_BYTES / 2);
    const tail = content.slice(-TRUNCATE_THRESHOLD_BYTES / 2);
    return {
      content: `${head}\n…[truncated · ${Math.round(fullBytes / 1024)} KB — expand]…\n${tail}`,
      truncated: true,
      fullBytes,
    };
  }
  const head = lines.slice(0, HEAD_LINES).join('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  return {
    content: `${head}\n…[truncated ${omitted} lines · ${Math.round(fullBytes / 1024)} KB — expand]…\n${tail}`,
    truncated: true,
    fullBytes,
  };
}
