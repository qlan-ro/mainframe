import { explorationKind } from './activity-label';
import { toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import { normalizedPath } from './file-summary';
import { displayText, record } from './values';
import type { ActivityMember, CompactToolPart } from './types';

type Category = 'tool' | 'edit' | 'read' | 'grep' | 'list' | 'shell' | 'web' | 'fetch';
type Tally = { targets: Set<string>; anonymous: number; failed: number };

const ORDER: readonly Category[] = ['tool', 'edit', 'read', 'grep', 'list', 'shell', 'web', 'fetch'];
const MAX_PARTS = 4;
const noStatusOverrides: ReadonlySet<string> = new Set();

function counted(count: number, one: string, many: (count: number) => string): string {
  return count === 1 ? one : many(count);
}
const phrases: Record<Category, (count: number) => string> = {
  tool: (n) => counted(n, 'Called a tool', (n) => `Called ${n} tools`),
  edit: (n) => counted(n, 'Edited a file', (n) => `Edited ${n} files`),
  read: (n) => counted(n, 'Read a file', (n) => `Read ${n} files`),
  grep: () => 'Searched code',
  list: () => 'Listed files',
  shell: (n) => counted(n, 'Ran a command', (n) => `Ran ${n} commands`),
  web: () => 'Searched the web',
  fetch: (n) => counted(n, 'Fetched a page', (n) => `Fetched ${n} pages`),
};

function readPaths(part: CompactToolPart): string[] {
  const path = normalizedPath(record(part.args)?.file_path);
  if (path) return [path];
  const actions = record(part.providerMetadata?.codex)?.commandActions;
  return Array.isArray(actions)
    ? actions.flatMap((action) => (record(action)?.type === 'read' ? [normalizedPath(record(action)?.path)] : []))
    : [];
}

/** The category a call counts under, and the distinct targets it touched (empty when unknown). */
function classify(part: CompactToolPart): { key: string; targets: string[] } | undefined {
  const kind = toolKind(part.toolName);
  if (kind === 'mcp') {
    const name = displayText(part.toolName.split('__')[1]);
    return name ? { key: `mcp:${name}`, targets: [] } : { key: 'tool', targets: [] };
  }
  if (kind === 'edit' || kind === 'write') {
    const path = normalizedPath(record(part.args)?.file_path);
    return { key: 'edit', targets: path ? [path] : [] };
  }
  const exploration = explorationKind(part);
  if (exploration === 'read') return { key: 'read', targets: readPaths(part).filter(Boolean) };
  if (exploration) return { key: exploration, targets: [] };
  if (kind === 'shell') return { key: 'shell', targets: [] };
  if (kind === 'web-search') return { key: 'web', targets: [] };
  if (kind === 'fetch') {
    const url = displayText(record(part.args)?.url);
    return { key: 'fetch', targets: url ? [url] : [] };
  }
  if (kind === 'subagent') return undefined;
  return { key: 'tool', targets: [] };
}

function tallies(members: readonly ActivityMember[]): Map<string, Tally> {
  const result = new Map<string, Tally>();
  for (const { part } of members) {
    if (part.type !== 'tool-call') continue;
    const entry = classify(part);
    if (!entry) continue;
    const tally = result.get(entry.key) ?? { targets: new Set<string>(), anonymous: 0, failed: 0 };
    if (entry.targets.length) for (const target of entry.targets) tally.targets.add(target);
    else tally.anonymous++;
    if (resolveToolStatus(part, noStatusOverrides) === 'failed') tally.failed++;
    result.set(entry.key, tally);
  }
  return result;
}

/**
 * Deterministic settled-group summary: one counted phrase per category, distinct targets
 * counted once, a failure suffix where calls failed, and the tail folded into "and N more".
 */
export function activitySummary(members: readonly ActivityMember[]): string {
  const byKey = tallies(members);
  const integrations = [...byKey.keys()].filter((key) => key.startsWith('mcp:')).sort();
  const keys = [...integrations, ...ORDER.filter((category) => byKey.has(category))];
  const phrasesInOrder = keys.map((key) => {
    const tally = byKey.get(key)!;
    const text = key.startsWith('mcp:')
      ? `Used ${key.slice(4)}`
      : phrases[key as Category](tally.targets.size + tally.anonymous);
    return tally.failed ? `${text} (${tally.failed} failed)` : text;
  });
  const shown =
    phrasesInOrder.length > MAX_PARTS
      ? [...phrasesInOrder.slice(0, MAX_PARTS - 1), `and ${phrasesInOrder.length - (MAX_PARTS - 1)} more`]
      : phrasesInOrder;
  const tools = members.some((member) => member.part.type === 'tool-call');
  return (
    shown.map((text, index) => (index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))).join(', ') ||
    (members.length && !tools ? 'Thought' : 'Worked')
  );
}
