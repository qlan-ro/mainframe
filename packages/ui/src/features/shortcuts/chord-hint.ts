/**
 * The one way UI outside the cheat sheet spells a chord.
 *
 * Every hint the app shows — palette rows, toolbar chips, tooltips — reads its
 * glyphs from the registry through here, so a re-chorded shortcut can never
 * leave a stale label behind (the sidebar hint read ⌘\ against a ⌘B binding).
 */
import { isMacPlatform } from './platform';
import { shortcutById, type ShortcutId } from './registry';
import { renderEntryChord } from './render-chord';

export function chordHint(id: ShortcutId): string {
  return renderEntryChord(shortcutById(id), isMacPlatform());
}
