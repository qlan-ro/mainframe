/**
 * Shared shiki token-rendering primitives.
 *
 * Both the chat `SyntaxHighlighter` and the markdown-preview `CodeBlock` use
 * these so the async-swap-in logic (mounted-ref guard, resolveLanguage,
 * plain-text fallback) lives in one place.
 *
 * Exports:
 *  - `useShikiTokens(code, langHint)` — hook that resolves to token lines or
 *    null while loading / for unknown languages. Re-tokenizes when the shiki
 *    theme is invalidated (mode/scheme change).
 *  - `TokenLine` — renders a single shiki token line as a `<span class="block">`.
 *  - `ShikiCode` — drop-in `<pre><code>` block that swaps from plain to
 *    highlighted once the highlighter resolves.
 */
import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ThemedToken, BundledLanguage } from 'shiki';
import {
  getShikiHighlighter,
  resolveLanguage,
  getShikiThemeVersion,
  subscribeShikiTheme,
} from '@/lib/shiki-highlighter';

// ── Theme version sync ────────────────────────────────────────────────────────

function useShikiThemeVersion(): number {
  return useSyncExternalStore(subscribeShikiTheme, getShikiThemeVersion, getShikiThemeVersion);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Resolves shiki token lines for `code` in `langHint`.
 * Returns null while loading or when the language is unknown / unsupported.
 * Re-tokenizes whenever the shiki theme is invalidated (e.g., after a mode/scheme change).
 */
export function useShikiTokens(code: string, langHint: string | undefined): ThemedToken[][] | null {
  const [lines, setLines] = useState<ThemedToken[][] | null>(null);
  const mountedRef = useRef(true);
  const themeVersion = useShikiThemeVersion();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const lang = resolveLanguage(langHint);
    if (!lang) {
      setLines(null);
      return;
    }

    getShikiHighlighter()
      .then(({ highlighter, theme }) => {
        if (!mountedRef.current) return;
        try {
          const result = highlighter.codeToTokens(code, { lang: lang as BundledLanguage, theme });
          setLines(result.tokens);
        } catch {
          /* expected: unsupported lang variant or tokenizer error — fall back to plain */
          if (mountedRef.current) setLines(null);
        }
      })
      .catch((err: unknown) => {
        console.warn('[shiki-tokens] highlight failed', { lang: langHint, err: String(err) });
        if (mountedRef.current) setLines(null);
      });
  }, [code, langHint, themeVersion]);

  return lines;
}

// ── TokenLine ─────────────────────────────────────────────────────────────────

/** Renders one line of shiki tokens as inline `<span>` elements. */
export function TokenLine({ tokens, addNewline }: { tokens: ThemedToken[]; addNewline: boolean }) {
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

// ── ShikiCode ─────────────────────────────────────────────────────────────────

interface ShikiCodeProps {
  code: string;
  lang: string | undefined;
  /** Tailwind / CSS class string applied to the outer `<pre>` element. */
  preClass: string;
}

/**
 * A `<pre><code>` block that renders plain text initially and swaps in shiki
 * highlighted token spans once the async highlighter resolves.
 *
 * Pass `preClass` to control all visual styling — the component itself applies
 * no theme tokens so each consumer can use its own pre class.
 */
export function ShikiCode({ code, lang, preClass }: ShikiCodeProps) {
  const lines = useShikiTokens(code, lang);

  if (lines) {
    return (
      <pre className={preClass}>
        <code>
          {lines.map((tokens, i) => (
            <TokenLine key={i} tokens={tokens} addNewline={i < lines.length - 1} />
          ))}
        </code>
      </pre>
    );
  }

  return (
    <pre className={preClass}>
      <code>{code}</code>
    </pre>
  );
}
