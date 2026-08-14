/**
 * Detects two entries claiming the same physical chord on a given platform —
 * a registration error, not a silent last-writer-wins (AC 9). Every chord of
 * every entry is checked, so a multi-chord entry (D3) is fully covered.
 */
import { chordKey, chordList, resolveChord } from './chord';
import type { ShortcutDescriptor } from './shortcut-types';

export function findChordConflicts(entries: readonly ShortcutDescriptor[], isMac: boolean): string[][] {
  const idsByKey = new Map<string, string[]>();
  for (const entry of entries) {
    for (const chord of chordList(entry)) {
      const key = chordKey(resolveChord(chord, isMac));
      const ids = idsByKey.get(key) ?? [];
      if (!ids.includes(entry.id)) ids.push(entry.id);
      idsByKey.set(key, ids);
    }
  }
  return [...idsByKey.values()].filter((ids) => ids.length > 1);
}
