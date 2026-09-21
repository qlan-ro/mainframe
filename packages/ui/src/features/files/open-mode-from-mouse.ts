import type { TabMode } from '@/store/run-pane';

/**
 * The tab mode a file-tree row click requests: holding the platform's
 * accelerator (⌘ on mac, Ctrl elsewhere) commits the file as a permanent tab;
 * a bare click keeps requesting a preview. Takes plain flags, not an event, so
 * tests need no `navigator` mock — same pattern as `hintModifierHeld`.
 */
export function openModeForMouseEvent(flags: { metaKey: boolean; ctrlKey: boolean }, isMac: boolean): TabMode {
  const accelerator = isMac ? flags.metaKey : flags.ctrlKey;
  return accelerator ? 'permanent' : 'preview';
}
