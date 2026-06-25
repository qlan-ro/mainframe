export type PaletteMode = 'file' | 'cmd' | 'sym' | 'chg';

export interface ParsedQuery {
  mode: PaletteMode;
  /** Query with the mode prefix stripped and trimmed. */
  term: string;
  /** Mode chip label shown in the field, or null for the default mode. */
  chip: string | null;
  placeholder: string;
}

const FILE_PLACEHOLDER = 'Search files…  · type > commands  @ symbols  # changes';

export function parseQuery(raw: string): ParsedQuery {
  if (raw.startsWith('>')) {
    return { mode: 'cmd', term: raw.slice(1).trim(), chip: 'Commands', placeholder: 'Run a command…' };
  }
  if (raw.startsWith('@')) {
    return { mode: 'sym', term: raw.slice(1).trim(), chip: 'Symbols', placeholder: 'Go to symbol…' };
  }
  if (raw.startsWith('#')) {
    return { mode: 'chg', term: raw.slice(1).trim(), chip: 'Changes', placeholder: 'Filter changed files…' };
  }
  return { mode: 'file', term: raw.trim(), chip: null, placeholder: FILE_PLACEHOLDER };
}
