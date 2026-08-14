import { emitSurfaceIntent } from '@/store/surface-intents';
import { useCheatSheetStore } from '@/features/shortcuts/cheat-sheet-store';
import { chordHint } from '@/features/shortcuts/chord-hint';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Keyboard hint glyphs (e.g. "⌘⇧R"); rendered as kbd chips. */
  hint?: string;
  run: () => void;
}

export function getPaletteCommands(): PaletteCommand[] {
  return [
    {
      id: 'review',
      label: 'Review changes…',
      hint: chordHint('app.review'),
      run: () => emitSurfaceIntent({ type: 'open-review' }),
    },
    {
      id: 'settings',
      label: 'Open Settings…',
      hint: chordHint('app.settings'),
      run: () => emitSurfaceIntent({ type: 'open-settings' }),
    },
    {
      id: 'sidebar',
      label: 'Toggle Sidebar',
      hint: chordHint('sessions.toggle-sidebar'),
      run: () => emitSurfaceIntent({ type: 'toggle-sidebar' }),
    },
    { id: 'files', label: 'Toggle Files', run: () => emitSurfaceIntent({ type: 'toggle-workspace-files' }) },
    {
      id: 'workspace',
      label: 'Reveal Workspace surface',
      run: () => emitSurfaceIntent({ type: 'activate-surface', surface: 'workspace' }),
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      hint: chordHint('app.cheat-sheet'),
      // Opens directly rather than through `toggleCheatSheet()`: the palette is
      // itself a Dialog, so the toggle's "another modal is open" guard would
      // stand down against the palette's own still-mounted content.
      run: () => useCheatSheetStore.getState().setOpen(true),
    },
  ];
}

export function filterCommands(cmds: PaletteCommand[], term: string): PaletteCommand[] {
  const t = term.trim().toLowerCase();
  if (!t) return cmds;
  return cmds.filter((c) => c.label.toLowerCase().includes(t));
}
