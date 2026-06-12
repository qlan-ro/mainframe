/**
 * Shiki-based syntax highlighter for code blocks in the markdown renderer.
 *
 * Uses the shared singleton engine from `@/lib/shiki-highlighter` so the WASM
 * grammar engine initialises once per session. Renders tokens as React spans —
 * no dangerouslySetInnerHTML.
 *
 * Fits the `SyntaxHighlighterProps` slot from @assistant-ui/react-markdown so
 * it can be passed as `SyntaxHighlighter` in the markdownComponents map.
 */
import { useState, useEffect, useRef, type FC } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import type { ThemedToken } from 'shiki';
import type { BundledLanguage } from 'shiki';
import { cn } from '@/lib/utils';
import { getShikiHighlighter, resolveLanguage } from '@/lib/shiki-highlighter';

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

    getShikiHighlighter()
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
