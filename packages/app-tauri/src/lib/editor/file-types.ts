/**
 * Maps file extensions to the installed `@codemirror/lang-*` pack ids and a
 * display icon string. Only extensions with a corresponding installed pack
 * return a specific id; everything else returns `'plaintext'`.
 *
 * Installed packs (from package.json):
 *   @codemirror/lang-javascript  →  'javascript' | 'typescript'
 *   @codemirror/lang-css         →  'css'
 *   @codemirror/lang-html        →  'html'
 *   @codemirror/lang-json        →  'json'
 *   @codemirror/lang-markdown    →  'markdown'
 *   @codemirror/lang-python      →  'python'
 *   @codemirror/lang-rust        →  'rust'
 *   @codemirror/legacy-modes     →  'yaml' | 'toml' | 'go' | 'sql' | 'shell' | 'scala' | 'java'
 */

export type LangPackId =
  | 'javascript'
  | 'typescript'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'yaml'
  | 'toml'
  | 'go'
  | 'sql'
  | 'shell'
  | 'scala'
  | 'java'
  | 'plaintext';

const EXT_TO_LANG: Record<string, LangPackId> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  svg: 'html',
  py: 'python',
  pyw: 'python',
  rs: 'rust',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  go: 'go',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  scala: 'scala',
  java: 'java',
};

/** Icon glyphs keyed by lang-pack id. Values are simple text labels / emoji-free. */
const LANG_ICONS: Record<LangPackId | 'default', string> = {
  typescript: 'TS',
  javascript: 'JS',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  markdown: 'MD',
  python: 'PY',
  rust: 'RS',
  yaml: 'YAML',
  toml: 'TOML',
  go: 'GO',
  sql: 'SQL',
  shell: 'SH',
  scala: 'SC',
  java: 'JAVA',
  plaintext: 'TXT',
  default: 'FILE',
};

/**
 * Infer the CM6 lang-pack id from a file path or filename.
 * Extension matching is case-insensitive.
 */
export function inferLanguage(filePath: string): LangPackId {
  const basename = filePath.split('/').pop() ?? filePath;
  const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : undefined;
  if (!ext) return 'plaintext';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

/**
 * Return a short icon label for a file path (used in tab strips and file
 * trees). Never returns an empty string.
 */
export function getFileIcon(filePath: string): string {
  const lang = inferLanguage(filePath);
  return LANG_ICONS[lang] ?? LANG_ICONS.default;
}
