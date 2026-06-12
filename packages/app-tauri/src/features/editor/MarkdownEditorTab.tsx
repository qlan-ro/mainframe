/**
 * MarkdownEditorTab — a markdown file in the Files surface with an Edit/Preview
 * toggle. Edit = the CM6 editor (markdown highlighting, editable); Preview =
 * rendered warm-chrome prose of the live buffer value wrapped in ViewerShell.
 */
import { useState } from 'react';
import { CmEditor } from './CmEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { ViewerShell } from '@/features/viewers/ViewerShell';
import { formatMarkdownStatus } from '@/features/viewers/viewer-status';

type Mode = 'edit' | 'preview';

interface MarkdownEditorTabProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

const SEG_BTN = 'h-[22px] rounded-[6px] px-2.5 text-caption transition-colors';

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

  const status = formatMarkdownStatus({ words: countWords(value), lines: countLines(value) });

  const toggle = (
    <div className="flex h-[30px] flex-shrink-0 items-center gap-1 bg-mf-tab-bar px-2 [border-bottom:0.5px_solid_var(--border)]">
      <div className="flex items-center gap-0.5 rounded-[7px] bg-mf-chip p-0.5">
        <button
          data-testid="markdown-mode-edit"
          type="button"
          onClick={() => setMode('edit')}
          aria-pressed={mode === 'edit'}
          className={`${SEG_BTN} ${mode === 'edit' ? 'bg-mf-tab-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Edit
        </button>
        <button
          data-testid="markdown-mode-preview"
          type="button"
          onClick={() => setMode('preview')}
          aria-pressed={mode === 'preview'}
          className={`${SEG_BTN} ${mode === 'preview' ? 'bg-mf-tab-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Preview
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toggle}

      <div className="min-h-0 flex-1">
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
          <ViewerShell path={path} status={status}>
            <MarkdownPreview value={value} />
          </ViewerShell>
        )}
      </div>
    </div>
  );
}
