/**
 * Synthesizes the explore tool-group header label from the grouped calls —
 * e.g. "Read 3 files · Searched 2 patterns". The daemon supplies no semantic
 * phase title, so this derived summary is the group header (decided 2026-06-05).
 */
export interface ToolGroupSummaryItem {
  readonly toolName: string;
}

export function toolGroupSummary(items: readonly ToolGroupSummaryItem[]): string {
  let reads = 0;
  let searches = 0;
  let globs = 0;
  let lists = 0;
  let other = 0;

  for (const item of items) {
    switch (item.toolName) {
      case 'Read':
      case 'NotebookRead':
        reads++;
        break;
      case 'Grep':
        searches++;
        break;
      case 'Glob':
        globs++;
        break;
      case 'LS':
        lists++;
        break;
      default:
        other++;
    }
  }

  const parts: string[] = [];
  if (reads) parts.push(`Read ${reads} file${reads === 1 ? '' : 's'}`);
  if (searches) parts.push(`Searched ${searches} pattern${searches === 1 ? '' : 's'}`);
  if (globs) parts.push(`Globbed ${globs} pattern${globs === 1 ? '' : 's'}`);
  if (lists) parts.push(`Listed ${lists} ${lists === 1 ? 'directory' : 'directories'}`);
  if (other) parts.push(`${other} tool${other === 1 ? '' : 's'}`);

  return parts.length > 0 ? parts.join(' · ') : `${items.length} tool ${items.length === 1 ? 'call' : 'calls'}`;
}
