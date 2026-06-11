/**
 * MarkdownEditorTab — a markdown file in the Files surface with an Edit/Preview
 * toggle. Edit = the CM6 editor (markdown highlighting, editable); Preview =
 * rendered warm-chrome prose of the live buffer value.
 */
import { useState } from 'react';
import { CmEditor } from './CmEditor';
import { MarkdownPreview } from './MarkdownPreview';

type Mode = 'edit' | 'preview';

interface MarkdownEditorTabProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
}

const SEG_BTN = 'h-[22px] rounded-[6px] px-2.5 text-caption transition-colors';

export function MarkdownEditorTab({ value, path, onChange }: MarkdownEditorTabProps) {
  const [mode, setMode] = useState<Mode>('edit');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Edit / Preview segmented toggle. */}
      <div className="flex h-[30px] flex-shrink-0 items-center gap-1 bg-mf-tab-bar px-2 [border-bottom:0.5px_solid_var(--border)]">
        <div className="flex items-center gap-0.5 rounded-[7px] bg-mf-chip-bg p-0.5">
          <button
            data-testid="markdown-mode-edit"
            type="button"
            onClick={() => setMode('edit')}
            aria-pressed={mode === 'edit'}
            className={`${SEG_BTN} ${mode === 'edit' ? 'bg-mf-tab-bar-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Edit
          </button>
          <button
            data-testid="markdown-mode-preview"
            type="button"
            onClick={() => setMode('preview')}
            aria-pressed={mode === 'preview'}
            className={`${SEG_BTN} ${mode === 'preview' ? 'bg-mf-tab-bar-active text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Preview
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {mode === 'edit' ? (
          <CmEditor value={value} language="markdown" readOnly={false} onChange={onChange} path={path} />
        ) : (
          <MarkdownPreview value={value} />
        )}
      </div>
    </div>
  );
}
