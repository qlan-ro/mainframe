'use client';

/**
 * CsvSource.tsx
 *
 * CSV "Source" mode: the read-only comment-gutter editor over the raw file
 * text, wired to the file tab's lifted note set. Gives header rows and
 * malformed lines — which the row-granular table can't address — a place to
 * take a line-exact note, same gesture as a code file (spec AC 21).
 */
import { CmEditorWithComments } from '@/features/editor/inline-comments/CmEditorWithComments';
import type { UseFileNotesResult } from '@/features/editor/inline-comments/use-file-notes';
import { inferLanguage } from '@/lib/editor/file-types';

interface CsvSourceProps {
  content: string;
  path: string;
  model: UseFileNotesResult;
}

export function CsvSource({ content, path, model }: CsvSourceProps) {
  return (
    <div data-testid="viewer-csv-source" className="mf-editor-selectable flex min-h-0 flex-1 flex-col">
      <CmEditorWithComments
        value={content}
        language={inferLanguage(path)}
        readOnly
        onChange={() => undefined}
        path={path}
        filePath={path}
        model={model}
      />
    </div>
  );
}
