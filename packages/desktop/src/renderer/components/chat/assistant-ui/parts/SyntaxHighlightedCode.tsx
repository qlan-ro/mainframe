import React, { useState, useEffect, useRef } from 'react';
import type { HighlighterCore } from 'shiki';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:chat');

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;

const LANGS = [
  'typescript',
  'javascript',
  'jsx',
  'tsx',
  'python',
  'rust',
  'go',
  'json',
  'yaml',
  'bash',
  'css',
  'html',
  'sql',
  'markdown',
  'diff',
  'toml',
  'xml',
  'c',
  'cpp',
  'java',
  'ruby',
  'swift',
  'kotlin',
];

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) return Promise.resolve(highlighterInstance);
  if (!highlighterPromise) {
    highlighterPromise = import('shiki')
      .then(({ createHighlighter }) => createHighlighter({ themes: ['vitesse-dark'], langs: LANGS }))
      .then((h) => {
        highlighterInstance = h;
        return h;
      });
  }
  return highlighterPromise;
}

// Map common aliases to shiki language ids
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
};

function resolveLang(lang: string | undefined): string {
  if (!lang) return 'text';
  const lower = lang.toLowerCase();
  const resolved = LANG_ALIASES[lower] ?? lower;
  return LANGS.includes(resolved) ? resolved : 'text';
}

export function SyntaxHighlightedCode({ code, language }: { code: string; language: string | undefined }) {
  const [html, setHtml] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const lang = resolveLang(language);
    if (lang === 'text') {
      setHtml(null);
      return;
    }

    getHighlighter()
      .then((h) => {
        if (!mountedRef.current) return;
        try {
          const result = h.codeToHtml(code, { lang, theme: 'vitesse-dark' });
          setHtml(result);
        } catch {
          setHtml(null);
        }
      })
      .catch((err) => {
        log.warn('syntax highlighting failed', { err: String(err) });
        if (mountedRef.current) setHtml(null);
      });
  }, [code, language]);

  if (html) {
    return (
      <div
        className="[&>pre]:!bg-transparent [&>pre]:!m-0 [&>pre]:p-3 [&>pre]:overflow-x-auto [&>pre>code]:!text-[14px] [&>pre>code]:!leading-[20px] [&>pre>code]:!font-[var(--font-mono)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback: plain code
  return <code className="block p-3 text-mf-body font-[var(--font-mono)] overflow-x-auto">{code}</code>;
}
