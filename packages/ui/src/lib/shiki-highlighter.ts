/**
 * Shared shiki engine singleton.
 *
 * Both the chat SyntaxHighlighter and the markdown preview code blocks consume
 * this module so the WASM grammar engine initialises only once per session.
 *
 * Consumers import `getShikiHighlighter()` and `resolveLanguage()`. They receive
 * both the highlighter and the CURRENT theme name — the theme name changes when
 * the appearance theme is invalidated (mode/scheme change).
 */
import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';

// ── Language support ──────────────────────────────────────────────────────────

type SupportedLang =
  | 'typescript'
  | 'javascript'
  | 'jsx'
  | 'tsx'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'bash'
  | 'css'
  | 'html'
  | 'sql'
  | 'markdown'
  | 'diff';

const SUPPORTED_SET = new Set<string>([
  'typescript',
  'javascript',
  'jsx',
  'tsx',
  'python',
  'rust',
  'go',
  'java',
  'json',
  'yaml',
  'toml',
  'xml',
  'bash',
  'css',
  'html',
  'sql',
  'markdown',
  'diff',
]);

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
};

/** Returns a shiki-compatible language string, or null for plain/unknown text. */
export function resolveLanguage(raw: string | undefined): SupportedLang | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const mapped = LANG_ALIASES[lower] ?? lower;
  return SUPPORTED_SET.has(mapped) ? (mapped as SupportedLang) : null;
}

// ── Warm-chrome shiki theme ───────────────────────────────────────────────────

function readVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) {
    throw new Error(`Missing design token ${name}`);
  }
  return value;
}

// ── Theme versioning ──────────────────────────────────────────────────────────

let themeVersion = 0;
const themeListeners = new Set<() => void>();

function currentThemeName(): string {
  return `mf-warm-chrome-${themeVersion}`;
}

function buildWarmChromeTheme() {
  return {
    name: currentThemeName(),
    type: 'dark' as const,
    colors: {
      'editor.background': readVar('--mf-code-bg'),
      'editor.foreground': readVar('--mf-code-fg'),
    },
    tokenColors: [
      {
        scope: ['keyword', 'storage', 'modifier'],
        settings: { foreground: readVar('--mf-code-kw') },
      },
      {
        scope: ['string', 'string.quoted', 'string.template'],
        settings: { foreground: readVar('--mf-code-str') },
      },
      {
        scope: ['entity.name.function', 'support.function'],
        settings: { foreground: readVar('--mf-code-fn') },
      },
      {
        scope: ['entity.name.type', 'support.type', 'entity.name.class'],
        settings: { foreground: readVar('--mf-code-type') },
      },
      {
        scope: ['constant.numeric', 'constant.language'],
        settings: { foreground: readVar('--mf-code-num') },
      },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: readVar('--mf-code-cmt'), fontStyle: 'italic' },
      },
    ],
  };
}

/** Invalidate the snapshotted code palette after a mode/scheme change. */
export function invalidateShikiTheme(): void {
  themeVersion += 1;
  themeListeners.forEach((l) => l());
}

export function getShikiThemeVersion(): number {
  return themeVersion;
}

export function subscribeShikiTheme(cb: () => void): () => void {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedThemes = new Set<string>();

/**
 * Returns the shiki highlighter plus the CURRENT theme name. Consumers must
 * tokenize with the returned `theme` (it changes when the appearance theme does).
 * On a theme change the next call loads a freshly-built theme into the existing
 * engine (no WASM re-init).
 */
export async function getShikiHighlighter(): Promise<{ highlighter: Highlighter; theme: string }> {
  const theme = currentThemeName();

  if (!highlighterPromise) {
    const themeAtInit = theme;
    highlighterPromise = createHighlighter({
      themes: [buildWarmChromeTheme()],
      langs: Array.from(SUPPORTED_SET) as BundledLanguage[],
    }).catch((err) => {
      console.warn('[shiki-highlighter] init failed', err);
      highlighterPromise = null;
      throw err as Error;
    });
    loadedThemes.add(themeAtInit);
    const highlighter = await highlighterPromise;
    return { highlighter, theme: themeAtInit };
  }

  const highlighter = await highlighterPromise;
  if (!loadedThemes.has(theme)) {
    await highlighter.loadTheme(buildWarmChromeTheme());
    loadedThemes.add(theme);
  }
  return { highlighter, theme };
}
