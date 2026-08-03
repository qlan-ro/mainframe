/**
 * skill-rows — one list out of two sources: the CLI's manifest of what is
 * installed, and the registry's catalog or search results.
 *
 * A skill you have and a skill you could have are the same object at different
 * points in its life, so the panel shows one row type and orders installed
 * first. Matching is on source *and* id: an id is only unique within its
 * source, and two `pdf` skills from different repos are different skills.
 *
 * A manifest entry with no source is a hand-made local skill. It has no
 * registry counterpart to match against — matching on the bare name would
 * label an unrelated registry skill as installed — so it keeps its own key and
 * simply lists as installed with nothing to enrich it.
 */
import type { SkillsCliEntry, SkillsCliScope } from '@qlan-ro/mainframe-types';
import type { BrowseItem } from './use-skills-browse-store';

export interface SkillRow {
  key: string;
  /** What the CLI calls it — the argument install and uninstall take. */
  skillId: string;
  /** What to show: the registry's display name where there is one. */
  name: string;
  source?: string;
  installs?: number;
  isOfficial?: boolean | null;
  /** Scopes the CLI has it in. Empty means it isn't installed. */
  scopes: SkillsCliScope[];
}

export interface SkillRows {
  installed: SkillRow[];
  available: SkillRow[];
}

const registryKey = (source: string, skillId: string): string => `${source}/${skillId}`;
const entryKey = (entry: SkillsCliEntry): string =>
  entry.source ? registryKey(entry.source, entry.name) : `local:${entry.name}`;

/**
 * @param query trimmed search text, or '' — installed rows are filtered
 *   locally against it, because the registry's search index knows nothing
 *   about this machine.
 */
export function buildSkillRows(
  entries: readonly SkillsCliEntry[],
  items: readonly BrowseItem[],
  query: string,
): SkillRows {
  const meta = new Map(items.map((item) => [registryKey(item.source, item.skillId), item]));

  const byKey = new Map<string, SkillRow>();
  for (const entry of entries) {
    const key = entryKey(entry);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.scopes.includes(entry.scope)) existing.scopes.push(entry.scope);
      continue;
    }
    const match = meta.get(key);
    byKey.set(key, {
      key,
      skillId: entry.name,
      name: match?.name ?? entry.name,
      source: entry.source ?? undefined,
      installs: match?.installs,
      isOfficial: match?.isOfficial,
      scopes: [entry.scope],
    });
  }

  const needle = query.toLowerCase();
  const installed = [...byKey.values()]
    .filter((row) => needle === '' || matches(row, needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const available = items
    .filter((item) => !byKey.has(registryKey(item.source, item.skillId)))
    .map((item) => ({
      key: registryKey(item.source, item.skillId),
      skillId: item.skillId,
      name: item.name,
      source: item.source,
      installs: item.installs,
      isOfficial: item.isOfficial,
      scopes: [],
    }));

  return { installed, available };
}

function matches(row: SkillRow, needle: string): boolean {
  return row.name.toLowerCase().includes(needle) || (row.source?.toLowerCase().includes(needle) ?? false);
}
