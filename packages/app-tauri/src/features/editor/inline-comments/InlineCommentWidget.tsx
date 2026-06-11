/**
 * InlineCommentWidget — the React card rendered inside a CM6 block decoration.
 *
 * Mounted via createPortal into a DOM node that CM6's decoration system
 * injects below the annotated line. The parent (CmEditor with comment support)
 * owns the portal host element and manages add/edit/delete state through
 * useInlineComments.
 *
 * Props:
 *   text          — current textarea value (controlled)
 *   lineContent   — preview of the annotated code line (optional context)
 *   onTextChange  — controlled input handler
 *   onSave        — called on Enter or Save button click (when text is non-empty)
 *   onClose       — called on Escape or Cancel button click
 *   onDelete      — if provided, a Delete button is rendered
 */
import { useEffect, useRef } from 'react';
import { Send, Trash2 } from 'lucide-react';

export interface InlineCommentWidgetProps {
  text: string;
  lineContent?: string;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function InlineCommentWidget({
  text,
  lineContent,
  onTextChange,
  onSave,
  onClose,
  onDelete,
}: InlineCommentWidgetProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div data-testid="editor-comment-widget" className="pt-2 pb-4 px-1">
      {lineContent && (
        <div className="mb-1.5 px-2 py-1 rounded bg-accent text-caption font-mono text-muted-foreground truncate">
          {lineContent}
        </div>
      )}
      <div className="w-full h-[64px] bg-card border border-border rounded-md px-3.5 py-3 box-border focus-within:ring-1 focus-within:ring-ring">
        <textarea
          data-testid="editor-comment-widget-input"
          ref={ref}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add context about this line..."
          className="w-full h-full resize-none bg-transparent p-0 border-0 text-body font-mono text-foreground outline-none focus:outline-none focus-visible:outline-none"
          style={{
            whiteSpace: 'pre-wrap',
            overflowX: 'hidden',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div className="flex items-center gap-2 mt-1">
        {onDelete && (
          <button
            data-testid="editor-comment-widget-delete"
            onClick={onDelete}
            className="px-2 py-0.5 rounded text-caption text-destructive hover:bg-mf-destructive-tint transition-colors"
            title="Delete comment"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          data-testid="editor-comment-widget-cancel"
          onClick={onClose}
          className="px-2 py-0.5 rounded text-caption text-muted-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          data-testid="editor-comment-widget-save"
          onClick={handleSave}
          disabled={!text.trim()}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-caption text-primary hover:bg-accent disabled:opacity-30 transition-colors"
        >
          <Send size={11} />
          Save
        </button>
      </div>
    </div>
  );
}
