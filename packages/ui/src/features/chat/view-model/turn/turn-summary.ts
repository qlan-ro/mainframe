/** "read 2 files, searched 1 pattern": what a turn's steps did, in the order of weight. Pure. */
import { normalizedPath } from './file-summary';
import { toolKind } from './tool-kind';
import { commandSummary, mcpName } from './tool-values';
import type { ToolPart } from './types';
import { displayText, record } from './values';

const MAX_PARTS = 3;

type Category = 'edit' | 'read' | 'grep' | 'list' | 'shell' | 'fetch' | 'web' | 'image' | 'artifact' | 'tool';
const ORDER: readonly Category[] = [
  'edit',
  'read',
  'grep',
  'list',
  'shell',
  'fetch',
  'web',
  'image',
  'artifact',
  'tool',
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const phrases: Record<Category, (n: number) => string> = {
  edit: (n) => `edited ${plural(n, 'file')}`,
  read: (n) => `read ${plural(n, 'file')}`,
  grep: (n) => `searched ${plural(n, 'pattern')}`,
  list: (n) => `listed ${plural(n, 'folder')}`,
  shell: (n) => `ran ${plural(n, 'command')}`,
  fetch: (n) => `fetched ${plural(n, 'page')}`,
  web: (n) => `searched the web${n === 1 ? '' : ` ${plural(n, 'time')}`}`,
  image: (n) => `generated ${plural(n, 'image')}`,
  artifact: (n) => `published ${plural(n, 'artifact')}`,
  tool: (n) => `called ${plural(n, 'tool')}`,
};

/** The category a call counts under, and the one target it counts once for. */
function classify(part: ToolPart): { key: Category | `mcp:${string}`; target?: string } | undefined {
  const args = record(part.args) ?? {};
  const kind = toolKind(part.toolName);
  switch (kind) {
    case 'subagent':
    case 'delegate':
    case 'workflow':
      return undefined; // the header counts child work itself (T1e)
    case 'edit':
    case 'write':
      return { key: 'edit', target: normalizedPath(args.file_path) || undefined };
    case 'read':
      return { key: 'read', target: normalizedPath(args.file_path) || undefined };
    case 'grep':
    case 'glob':
      return { key: 'grep', target: displayText(args.pattern ?? args.glob) || undefined };
    case 'list':
      return { key: kind };
    case 'shell': {
      const summary = commandSummary(part);
      return summary ? { key: summary.kind, target: summary.target } : { key: 'shell' };
    }
    case 'web-search':
      return { key: 'web' };
    case 'mcp':
      return { key: `mcp:${mcpName(part.toolName).server}` };
    case 'fetch':
    case 'artifact':
      return { key: kind };
    default:
      return { key: 'tool' };
  }
}

/** `images`: pictures the agent made, which no tool call stands for. */
export function turnSummary(parts: readonly ToolPart[], images = 0): string {
  const tallies = new Map<string, { targets: Set<string>; anonymous: number }>();
  for (const part of parts) {
    const entry = classify(part);
    if (!entry) continue;
    const tally = tallies.get(entry.key) ?? { targets: new Set<string>(), anonymous: 0 };
    if (entry.target) tally.targets.add(entry.target);
    else tally.anonymous++;
    tallies.set(entry.key, tally);
  }
  if (images) tallies.set('image', { targets: new Set(), anonymous: images });
  const servers = [...tallies.keys()].filter((key) => key.startsWith('mcp:'));
  const keys = [...ORDER.filter((key) => tallies.has(key)), ...servers];
  const texts = keys.map((key) => {
    if (key.startsWith('mcp:')) return `called ${key.slice(4)}`;
    const tally = tallies.get(key)!;
    return phrases[key as Category](tally.targets.size + tally.anonymous);
  });
  const shown =
    texts.length > MAX_PARTS + 1 ? [...texts.slice(0, MAX_PARTS), `${texts.length - MAX_PARTS} more`] : texts;
  return shown.join(', ');
}

/** "5 files, 2 searches": a collapsed run of reads and searches. */
export function exploreSummary(parts: readonly ToolPart[]): string {
  let files = 0;
  let searches = 0;
  for (const part of parts) {
    if (toolKind(part.toolName) === 'read') files++;
    else searches++;
  }
  return [files ? plural(files, 'file') : '', searches ? plural(searches, 'search', 'searches') : '']
    .filter(Boolean)
    .join(', ');
}
