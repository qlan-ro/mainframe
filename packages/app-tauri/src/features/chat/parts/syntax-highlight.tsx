/**
 * Shiki-based syntax highlighter for code blocks in the markdown renderer.
 *
 * Uses a module-level singleton so the WASM grammar engine initialises once per
 * session. Renders tokens as React spans — no dangerouslySetInnerHTML.
 *
 * Fits the `SyntaxHighlighterProps` slot from @assistant-ui/react-markdown so it
 * can be passed as `SyntaxHighlighter` in the markdownComponents map.
 */
import { useState, useEffect, useRef, type FC } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { getSingletonHighlighter, type BundledLanguage, type ThemedToken } from 'shiki';
import { cn } from '@/lib/utils';

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

/** Returns a BundledLanguage-compatible string, or null for plain text. */
function resolveLanguage(raw: string | undefined): SupportedLang | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const mapped = LANG_ALIASES[lower] ?? lower;
  return SUPPORTED_SET.has(mapped) ? (mapped as SupportedLang) : null;
}

// ── Warm-chrome shiki theme ───────────────────────────────────────────────────
// Reads CSS vars at first init so the palette follows the active light/dark mode.
// The singleton is recreated on the next page load when the mode changes.

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

// ── Singleton init ────────────────────────────────────────────────────────────

type HighlighterInstance = Awaited<ReturnType<typeof getSingletonHighlighter>>;

let highlighterPromise: Promise<HighlighterInstance> | null = null;

function getHighlighter(): Promise<HighlighterInstance> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: [buildWarmChromeTheme()],
      langs: SUPPORTED_SET as unknown as BundledLanguage[],
    }).catch((err) => {
      console.warn('[syntax-highlight] shiki init failed', err);
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

// ── Token rendering ───────────────────────────────────────────────────────────

function TokenLine({ tokens, addNewline }: { tokens: ThemedToken[]; addNewline: boolean }) {
  return (
    <span className="block">
      {tokens.map((tok, i) => (
        <span key={i} style={{ color: tok.color }}>
          {tok.content}
        </span>
      ))}
      {addNewline && '\n'}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({ code, language }) => {
  const [lines, setLines] = useState<ThemedToken[][] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const lang = resolveLanguage(language);
    if (!lang) {
      setLines(null);
      return;
    }

    getHighlighter()
      .then((h) => {
        if (!mountedRef.current) return;
        try {
          const result = h.codeToTokens(code, {
            lang: lang as BundledLanguage,
            theme: 'mf-warm-chrome',
          });
          setLines(result.tokens);
        } catch {
          if (mountedRef.current) setLines(null);
        }
      })
      .catch((err) => {
        console.warn('[syntax-highlight] highlight failed', { language, err: String(err) });
        if (mountedRef.current) setLines(null);
      });
  }, [code, language]);

  if (lines) {
    return (
      <pre
        className={cn('bg-mf-code-bg text-mf-code-fg overflow-x-auto p-3 m-0 border-0 font-mono text-label leading-5')}
      >
        <code>
          {lines.map((tokens, i) => (
            <TokenLine key={i} tokens={tokens} addNewline={i < lines.length - 1} />
          ))}
        </code>
      </pre>
    );
  }

  return (
    <pre className="bg-mf-code-bg text-mf-code-fg overflow-x-auto p-3 m-0 border-0 font-mono text-label leading-5">
      <code>{code}</code>
    </pre>
  );
};

SyntaxHighlighter.displayName = 'SyntaxHighlighter';
