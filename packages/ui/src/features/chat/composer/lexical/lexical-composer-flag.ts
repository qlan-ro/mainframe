/**
 * Dev flag for the Lexical chip composer spike (todo #482). Off by default.
 *
 * Turn it on with `VITE_MF_LEXICAL_COMPOSER=1` at build time, or at runtime
 * with `localStorage.setItem('mf:dev:lexical-composer', '1')` and a reload.
 * Read once per load: switching the field under a mounted composer would drop
 * the editor's undo history and selection.
 */
const STORAGE_KEY = 'mf:dev:lexical-composer';

function readFlag(): boolean {
  if (import.meta.env.VITE_MF_LEXICAL_COMPOSER === '1') return true;
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = readFlag();

export function isLexicalComposerEnabled(): boolean {
  return enabled;
}
