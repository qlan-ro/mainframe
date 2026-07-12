/**
 * DiffTab — renders a side-by-side diff for a 'diff' kind tab.
 *
 * Two modes:
 *  1. Pre-resolved: caller passes `original`/`modified` directly (e.g. chat tool card).
 *  2. Path-only: no sides provided → fetches HEAD-vs-working via getWorkingDiff.
 *     Empty both sides (untracked/clean file) → "No diff available".
 *
 * Content is derived from state so re-opening a diff with new content can never
 * show stale sides.
 *
 * data-testid: "diff-tab" on root.
 */
import { useCallback, useEffect, useState } from 'react';
import { inferLanguage } from '@/lib/editor/file-types';
import { getWorkingDiff } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { CmDiffEditorWithComments } from './inline-comments/CmDiffEditorWithComments';
import { DiffHeader } from './DiffHeader';
import { nextChange, prevChange } from './diff-nav';

interface DiffTabProps {
  path: string;
  /** Pre-resolved original (base) text. When omitted, fetches HEAD-vs-working. */
  original?: string;
  /** Pre-resolved modified (changed) text. When omitted, fetches HEAD-vs-working. */
  modified?: string;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; original: string; modified: string }
  | { status: 'unavailable' };

export function DiffTab({ path, original: origProp, modified: modProp }: DiffTabProps) {
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const [changeCount, setChangeCount] = useState(0);

  // When both sides are pre-resolved, skip the fetch entirely.
  const hasPreResolved = origProp !== undefined && modProp !== undefined;

  const [fetchState, setFetchState] = useState<FetchState>(() => {
    if (origProp !== undefined && modProp !== undefined) {
      return { status: 'ready', original: origProp, modified: modProp };
    }
    return { status: 'loading' };
  });

  // When pre-resolved props change on an already-mounted component, sync fetchState.
  // CmDiffEditor is mount-only for doc content, so we must update state here so
  // the parent can force a remount via a key change (see key prop on CmDiffEditor below).
  useEffect(() => {
    if (!hasPreResolved) return;
    setFetchState({ status: 'ready', original: origProp!, modified: modProp! });
  }, [hasPreResolved, origProp, modProp]);

  useEffect(() => {
    if (hasPreResolved) return;
    if (!projectId) {
      setFetchState({ status: 'unavailable' });
      return;
    }

    let cancelled = false;
    setFetchState({ status: 'loading' });

    getWorkingDiff(port, projectId, path, { chatId })
      .then((result) => {
        if (cancelled) return;
        if (!result.original && !result.modified) {
          setFetchState({ status: 'unavailable' });
        } else {
          setFetchState({ status: 'ready', original: result.original, modified: result.modified });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[DiffTab] working-diff fetch failed', path, err);
        setFetchState({ status: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [hasPreResolved, port, projectId, path, chatId]);

  // CmDiffEditor reports the chunk count synchronously after its MergeView
  // mounts so the header stays correct without polling a global singleton.
  const handleChunksChange = useCallback((count: number) => {
    setChangeCount(count);
  }, []);

  if (fetchState.status === 'unavailable') {
    return (
      <div data-testid="diff-tab" className="flex h-full items-center justify-center text-body text-muted-foreground">
        No diff available — this file has no uncommitted changes.
      </div>
    );
  }

  if (fetchState.status === 'loading') {
    return (
      <div data-testid="diff-tab" className="flex h-full items-center justify-center text-body text-muted-foreground">
        Loading diff…
      </div>
    );
  }

  const { original, modified } = fetchState;
  const language = inferLanguage(path);
  const fileName = path.split('/').pop() ?? path;

  return (
    <div data-testid="diff-tab" className="flex h-full flex-col overflow-hidden">
      <DiffHeader
        fileName={fileName}
        changeCount={changeCount}
        filePath={path}
        onPrev={prevChange}
        onNext={nextChange}
      />
      <CmDiffEditorWithComments
        key={`${original}\x00${modified}`}
        original={original}
        modified={modified}
        language={language}
        path={path}
        filePath={path}
        onChunksChange={handleChunksChange}
      />
    </div>
  );
}
