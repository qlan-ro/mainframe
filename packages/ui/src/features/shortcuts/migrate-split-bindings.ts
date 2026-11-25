import { chordHolder, effectiveBindings } from './effective-bindings';
import type { Overrides } from './keybindings-store';
import { isMacPlatform } from './platform';
import { SHORTCUTS } from './registry';

const renamedIds = [
  ['sessions.open-in-split', 'sessions.open-beside'],
  ['sessions.close-split', 'sessions.close-beside'],
] as const;

export function migrateSplitBindings(overrides: Overrides): Overrides {
  const next = { ...overrides };
  const isMac = isMacPlatform();

  const moved = new Set<string>();
  for (const [oldId, newId] of renamedIds) {
    const chord = next[oldId];
    delete next[oldId];
    if (chord === undefined || Object.prototype.hasOwnProperty.call(next, newId)) continue;
    next[newId] = chord;
    if (chord) moved.add(newId);
  }

  while (moved.size > 0) {
    const bindings = effectiveBindings(SHORTCUTS, next);
    const conflicts = [...moved].filter((id) => {
      const chord = next[id];
      return chord && chordHolder(bindings, chord, isMac, id);
    });
    if (conflicts.length === 0) break;
    for (const id of conflicts) {
      delete next[id];
      moved.delete(id);
    }
  }

  return next;
}
