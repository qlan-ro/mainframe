/**
 * installed-index — joins the CLI's manifest onto the registry rows so Browse
 * can say which skills are already on the machine.
 *
 * The join is `source/name` against `source/skillId`: the CLI records the
 * source it installed from, and that pair is what identifies a registry skill —
 * an id is only unique within its source. Manifest rows without a source are
 * left out on purpose. They are hand-made local skills, and matching them by
 * bare name would label an unrelated registry skill as installed.
 *
 * A skill can be installed in both scopes, so the value is a list, not a flag.
 */
import type { SkillsCliEntry, SkillsCliScope } from '@qlan-ro/mainframe-types';
import { browseKey, type BrowseItem } from './use-skills-browse-store';

export type InstalledIndex = ReadonlyMap<string, SkillsCliScope[]>;

const NONE: SkillsCliScope[] = [];

export function buildInstalledIndex(entries: readonly SkillsCliEntry[]): InstalledIndex {
  const index = new Map<string, SkillsCliScope[]>();
  for (const entry of entries) {
    if (!entry.source) continue;
    const key = browseKey({ source: entry.source, skillId: entry.name, name: entry.name, installs: 0 });
    const scopes = index.get(key);
    if (!scopes) index.set(key, [entry.scope]);
    else if (!scopes.includes(entry.scope)) scopes.push(entry.scope);
  }
  return index;
}

/** Stable empty result, so a row with no match doesn't get a new array each render. */
export function installedScopesFor(index: InstalledIndex, item: BrowseItem): SkillsCliScope[] {
  return index.get(browseKey(item)) ?? NONE;
}
