/**
 * MarkdownEditorTab — a markdown file in the Files surface with a Preview/Source
 * toggle. Source = the CM6 editor (markdown highlighting, editable); Preview =
 * rendered warm-chrome prose of the live buffer value.
 *
 * A single persistent ViewerShell provides the breadcrumb header and status
 * footer in both modes — the toggle sits in the header's `actions` slot so
 * there is no duplicate chrome bar.
 */
import { useState } from 'react';
import { CmEditor } from './CmEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { ViewerShell } from '@/features/viewers/ViewerShell';
import { splitMarkdownStatus } from '@/features/viewers/viewer-status';

type Mode = 'edit' | 'preview';

interface MarkdownEditorTabProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

// Active segment gets a subtle raised-card ring per spec (0.5px uniform ring via border var).
const ACTIVE_CLASS = 'bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)]';
const INACTIVE_CLASS = 'text-muted-foreground hover:text-foreground';
const SEG_BTN = 'h-[18px] rounded-md px-[8px] text-caption transition-colors';

/** Count words in markdown source (split on whitespace, filter empty). */
function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** Count non-empty lines. */
function countLines(text: string): number {
  return text.split('\n').length;
}

export function MarkdownEditorTab({ value, path, onChange, onSave, readOnly = false }: MarkdownEditorTabProps) {
  const [mode, setMode] = useState<Mode>('edit');

  const { left: status, right: statusRight } = splitMarkdownStatus(countWords(value), countLines(value));

  // Toggle segment control — passed into ViewerShell's actions slot so it lives
  // in the header row, not as a separate sub-bar.
  const toggle = (
    <div className="flex items-center gap-px rounded-md bg-mf-chip p-0.5">
      <button
        data-testid="markdown-mode-preview"
        type="button"
        onClick={() => setMode('preview')}
        aria-pressed={mode === 'preview'}
        className={`${SEG_BTN} ${mode === 'preview' ? ACTIVE_CLASS : INACTIVE_CLASS}`}
      >
        Preview
      </button>
      <button
        data-testid="markdown-mode-edit"
        type="button"
        onClick={() => setMode('edit')}
        aria-pressed={mode === 'edit'}
        className={`${SEG_BTN} ${mode === 'edit' ? ACTIVE_CLASS : INACTIVE_CLASS}`}
      >
        Source
      </button>
    </div>
  );

  return (
    <ViewerShell path={path} status={status} statusRight={statusRight} actions={toggle}>
      {mode === 'edit' ? (
        <CmEditor
          value={value}
          language="markdown"
          readOnly={readOnly}
          onChange={onChange}
          onSave={onSave}
          path={path}
        />
      ) : (
        <MarkdownPreview value={value} />
      )}
    </ViewerShell>
  );
}
