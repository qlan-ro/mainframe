/**
 * DiffTab — renders a side-by-side diff for a 'diff' kind tab.
 *
 * Diffs are opened with both sides pre-resolved (a chat tool card passes
 * `original`/`modified`). A path-only diff (no HEAD-vs-working endpoint yet)
 * renders an "unavailable" state rather than diffing the file against itself.
 *
 * Content is derived directly from props (no local state) so re-opening a diff
 * with new content can never show stale sides.
 *
 * data-testid: "diff-tab" on root.
 */
import { useCallback, useState } from 'react';
import { inferLanguage } from '@/lib/editor/file-types';
import { CmDiffEditor } from './CmDiffEditor';
import { DiffHeader } from './DiffHeader';
import { nextChange, prevChange } from './diff-nav';

interface DiffTabProps {
  path: string;
  /** Pre-resolved original (base) text. */
  original?: string;
  /** Pre-resolved modified (changed) text. */
  modified?: string;
}

export function DiffTab({ path, original, modified }: DiffTabProps) {
  const [changeCount, setChangeCount] = useState(0);

  // CmDiffEditor reports the chunk count synchronously after its MergeView
  // mounts so the header stays correct without polling a global singleton.
  const handleChunksChange = useCallback((count: number) => {
    setChangeCount(count);
  }, []);

  if (original === undefined || modified === undefined) {
    return (
      <div data-testid="diff-tab" className="flex h-full items-center justify-center text-body text-muted-foreground">
        Diff unavailable — open this file from a chat diff card.
      </div>
    );
  }

  const language = inferLanguage(path);
  const fileName = path.split('/').pop() ?? path;

  return (
    <div data-testid="diff-tab" className="flex h-full flex-col overflow-hidden">
      <DiffHeader fileName={fileName} changeCount={changeCount} onPrev={prevChange} onNext={nextChange} />
      <CmDiffEditor
        original={original}
        modified={modified}
        language={language}
        path={path}
        onChunksChange={handleChunksChange}
      />
    </div>
  );
}
