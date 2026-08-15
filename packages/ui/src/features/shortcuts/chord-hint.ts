/**
 * The one way UI outside the cheat sheet spells a chord.
 *
 * Every hint the app shows — palette rows, toolbar chips, tooltips — reads its
 * glyphs from the registry through here, so a re-chorded shortcut can never
 * leave a stale label behind (the sidebar hint read ⌘\ against a ⌘B binding).
 * That now includes USER rebinds: the override layer is resolved here too,
 * which is why this reads the store rather than the raw registry.
 */
import { isMacPlatform } from './platform';
import { shortcutById, type ShortcutId } from './registry';
import { renderEntryChord } from './render-chord';
import { effectiveBindings } from './effective-bindings';
import { useKeybindingsStore } from './keybindings-store';

/** The chord to show for `id`, or `null` when the user left it unassigned. */
export function chordHint(id: ShortcutId): string | null {
  const entry = shortcutById(id);
  // A plain function, not a hook: call sites are menu items and tooltips that
  // re-render with their parent, so a snapshot read is enough and keeps this
  // usable outside React.
  const { overrides } = useKeybindingsStore.getState();
  const binding = effectiveBindings([entry], overrides)[0];
  if (binding == null || binding.chord === null) return null;
  return renderEntryChord({ ...entry, chord: binding.chord }, isMacPlatform());
}
