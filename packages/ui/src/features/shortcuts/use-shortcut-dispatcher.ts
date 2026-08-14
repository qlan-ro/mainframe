/**
 * The app's ONE window-level keydown listener. Mounted once by AppShell; every
 * app shortcut flows through it, so nothing else in the app registers a
 * window/document listener for a chord (overlay-local Escape and the code
 * editor's own CM6 keymap are the exempt cases).
 *
 * A match must clear eligibility (editor yield + the text-field rule) AND find
 * a registered handler before the keystroke is taken from the browser — an
 * unbound chord leaves the default intact rather than swallowing it.
 */
import { useEffect } from 'react';
import { shortcutAction } from './action-store';
import { chordList, matchesChord, resolveChord } from './chord';
import { isEligibleTarget } from './eligibility';
import { isMacPlatform } from './platform';
import { SHORTCUTS, visibleShortcuts } from './registry';

export function useShortcutDispatcher(): void {
  useEffect(() => {
    const isMac = isMacPlatform();
    // The dev gate is applied at this one mount site, so `dev: true` entries
    // need no second guard in the feature that owns them.
    const entries = visibleShortcuts(SHORTCUTS, { dev: import.meta.env.DEV }).map((entry) => ({
      entry,
      chords: chordList(entry).map((chord) => resolveChord(chord, isMac)),
    }));

    function onKeyDown(event: KeyboardEvent) {
      for (const { entry, chords } of entries) {
        const index = chords.findIndex((chord) => matchesChord(event, chord));
        if (index === -1) continue;
        if (!isEligibleTarget(event.target, entry, chords[index]!)) continue;
        const action = shortcutAction(entry.id);
        if (action == null) continue;
        event.preventDefault();
        action(index);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
