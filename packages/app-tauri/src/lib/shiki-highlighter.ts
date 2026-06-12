/**
 * Shared shiki engine singleton.
 *
 * Both the chat SyntaxHighlighter and the markdown preview code blocks consume
 * this module so the WASM grammar engine initialises only once per session.
 *
 * Consumers import `getShikiHighlighter()` and `resolveLanguage()`. They own
 * the theme used for tokenization — the engine is theme-aware but the theme
 * object is passed in at call time.
 */
import { getSingletonHighlighter, type BundledLanguage } from 'shiki';

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

function buildWarmChromeTheme() {
  return {
    name: 'mf-warm-chrome' as const,
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

// ── Singleton ─────────────────────────────────────────────────────────────────

type HighlighterInstance = Awaited<ReturnType<typeof getSingletonHighlighter>>;

let highlighterPromise: Promise<HighlighterInstance> | null = null;

/**
 * Returns the singleton shiki highlighter, initialising it on first call.
 * The promise is cached; failed inits clear the cache so the next call retries.
 */
export function getShikiHighlighter(): Promise<HighlighterInstance> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: [buildWarmChromeTheme()],
      langs: SUPPORTED_SET as unknown as BundledLanguage[],
    }).catch((err) => {
      console.warn('[shiki-highlighter] init failed', err);
      highlighterPromise = null;
      throw err as Error;
    });
  }
  return highlighterPromise;
}
