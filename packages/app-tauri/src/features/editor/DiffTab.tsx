/**
 * DiffTab — renders a side-by-side diff for a 'diff' kind tab.
 *
 * The original and modified strings can be passed directly from the tab model
 * (e.g. when the diff is opened programmatically by a chat tool card) OR loaded
 * from disk (original = HEAD content, modified = working-tree content) when only
 * the path is available.
 *
 * Phase 4 (CmDiffEditor) provides the MergeView; this is the integration wrapper
 * that resolves content, then hands off rendering.
 *
 * data-testid: "diff-tab" on root.
 */
import { useEffect, useState } from 'react';
import { readFile } from '@/lib/tauri/bridge';
import { inferLanguage } from '@/lib/editor/file-types';
import { CmDiffEditor } from './CmDiffEditor';

interface DiffTabProps {
  path: string;
  /** Pre-resolved original (base) text. If omitted, we fall back to disk. */
  original?: string;
  /** Pre-resolved modified (changed) text. If omitted, we fall back to disk. */
  modified?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; original: string; modified: string }
  | { status: 'error'; message: string };

export function DiffTab({ path, original, modified }: DiffTabProps) {
  const [loadState, setLoadState] = useState<LoadState>(() => {
    // If both sides are already available, skip async load.
    if (original !== undefined && modified !== undefined) {
      return { status: 'ready', original, modified };
    }
    return { status: 'loading' };
  });

  useEffect(() => {
    // If the caller already provided both sides, nothing to load.
    if (original !== undefined && modified !== undefined) return;

    let cancelled = false;
    setLoadState({ status: 'loading' });

    readFile(path)
      .then((content) => {
        if (cancelled) return;
        const text = content ?? '';
        setLoadState({ status: 'ready', original: text, modified: text });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[DiffTab] failed to load file', path, message);
        setLoadState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [path, original, modified]);

  if (loadState.status === 'loading') {
    return (
      <div data-testid="diff-tab" className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading diff…
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div data-testid="diff-tab" className="flex h-full items-center justify-center text-sm text-destructive">
        {loadState.message}
      </div>
    );
  }

  const language = inferLanguage(path);

  return (
    <div data-testid="diff-tab" className="flex h-full flex-col overflow-hidden">
      <CmDiffEditor original={loadState.original} modified={loadState.modified} language={language} path={path} />
    </div>
  );
}
