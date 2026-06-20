import { emitSurfaceIntent } from '@/store/surface-intents';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Keyboard hint glyphs (e.g. "⌘⇧R"); rendered as kbd chips. */
  hint?: string;
  run: () => void;
}

export function getPaletteCommands(): PaletteCommand[] {
  return [
    { id: 'review', label: 'Review changes…', hint: '⌘⇧R', run: () => emitSurfaceIntent({ type: 'open-review' }) },
    { id: 'settings', label: 'Open Settings…', hint: '⌘,', run: () => emitSurfaceIntent({ type: 'open-settings' }) },
    { id: 'sidebar', label: 'Toggle Sidebar', hint: '⌘\\', run: () => emitSurfaceIntent({ type: 'toggle-sidebar' }) },
    { id: 'inspector', label: 'Toggle Inspector', run: () => emitSurfaceIntent({ type: 'toggle-inspector' }) },
    { id: 'files', label: 'Reveal Files surface', run: () => emitSurfaceIntent({ type: 'activate-surface', surface: 'files' }) },
    { id: 'run', label: 'Reveal Run surface', run: () => emitSurfaceIntent({ type: 'activate-surface', surface: 'run' }) },
  ];
}

export function filterCommands(cmds: PaletteCommand[], term: string): PaletteCommand[] {
  const t = term.trim().toLowerCase();
  if (!t) return cmds;
  return cmds.filter((c) => c.label.toLowerCase().includes(t));
}
