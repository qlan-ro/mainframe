/**
 * MarkdownEditorTab — a markdown file in the workspace surface with a Preview/Source
 * toggle. Source = the CM6 editor (markdown highlighting, editable); Preview =
 * rendered warm-chrome prose of the live buffer value.
 *
 * A single persistent ViewerShell provides the breadcrumb header and status
 * footer in both modes — the toggle sits in the header's `actions` slot so
 * there is no duplicate chrome bar.
 */
import { useState } from 'react';
import { CmEditorWithComments } from './inline-comments/CmEditorWithComments';
import { useFileTabNotes } from './inline-comments/use-file-notes';
import { MarkdownPreview } from './MarkdownPreview';
import { ViewerShell } from '@/features/viewers/ViewerShell';
import { Segmented } from '@/features/viewers/Segmented';
import { splitMarkdownStatus } from '@/features/viewers/viewer-status';

type Mode = 'edit' | 'preview';

interface MarkdownEditorTabProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

/** Count words in markdown source (split on whitespace, filter empty). */
function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** Count non-empty lines. */
function countLines(text: string): number {
  return text.split('\n').length;
}

export function MarkdownEditorTab({ value, path, onChange, onSave, readOnly = false }: MarkdownEditorTabProps) {
  // Markdown opens rendered (Preview) by default — like the other special viewers
  // (svg/csv/image/pdf). Switch to Source to edit.
  const [mode, setMode] = useState<Mode>('preview');
  const { model, submitBar, openNote, openNoteId, handleSendOne } = useFileTabNotes({ filePath: path });

  const { left: status, right: statusRight } = splitMarkdownStatus(countWords(value), countLines(value));

  // Toggle segment control — passed into ViewerShell's actions slot so it lives
  // in the header row, not as a separate sub-bar.
  const toggle = (
    <Segmented
      value={mode}
      onChange={(id) => setMode(id as Mode)}
      options={[
        { id: 'preview', label: 'Preview', testId: 'markdown-mode-preview' },
        { id: 'edit', label: 'Source', testId: 'markdown-mode-edit' },
      ]}
    />
  );

  return (
    <ViewerShell path={path} status={status} statusRight={statusRight} actions={toggle}>
      <div className="flex min-h-0 flex-1 flex-col">
        {submitBar}
        <div className="min-h-0 flex-1">
          {mode === 'edit' ? (
            <CmEditorWithComments
              value={value}
              language="markdown"
              readOnly={readOnly}
              onChange={onChange}
              onSave={onSave}
              path={path}
              filePath={path}
              model={model}
            />
          ) : (
            <MarkdownPreview value={value} notes={{ model, openNoteId, openNote, handleSendOne }} />
          )}
        </div>
      </div>
    </ViewerShell>
  );
}
