/**
 * InlineCommentWidget — the React card rendered inside a CM6 block decoration.
 *
 * Mounted via createPortal into a DOM node that CM6's decoration system
 * injects below the annotated line. The parent (CmEditor with comment support)
 * owns the portal host element and manages add/edit/delete state through
 * useInlineComments.
 *
 * Design per EditorCommentWidget (03-content.jsx):
 *   Header row (6px pad, hairline bottom):
 *     Sparkles icon (text-primary) + "Agent context" (caption semibold
 *     text-muted-foreground) + "line N" (mono micro text-mf-text-4) + close X
 *   Card: shadow-pop, accent border when editing (focus-within:border-primary/40)
 *   Textarea: min-h-[52px] px-[11px] py-[9px], ⌘↩ to submit
 *   Footer: "⌘↩ to add" hint + Cancel + "Add context" primary button
 *
 * Props:
 *   text          — current textarea value (controlled)
 *   lineNumber    — 1-based line number of the annotated line (optional display)
 *   lineContent   — preview of the annotated code line (optional context)
 *   onTextChange  — controlled input handler
 *   onSave        — called on ⌘↩ or "Add context" button click (when text is non-empty)
 *   onClose       — called on Escape or Cancel button click
 *   onDelete      — if provided, the widget supports deletion
 */
import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';

export interface InlineCommentWidgetProps {
  text: string;
  lineNumber?: number;
  lineContent?: string;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function InlineCommentWidget({
  text,
  lineNumber,
  lineContent: _lineContent,
  onTextChange,
  onSave,
  onClose,
  onDelete: _onDelete,
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
    // ⌘↩ or Ctrl+↩ to submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div data-testid="editor-comment-widget" className="flex py-[5px] pl-[14px] pr-[14px] font-sans">
      {/* Sparkles gutter indicator */}
      <div className="mr-[10px] flex w-[12px] shrink-0 items-start pt-[9px]">
        <Sparkles size={11} className="text-primary" aria-hidden />
      </div>

      {/* Card */}
      <div className="flex-1 overflow-hidden rounded-[8px] border border-border bg-card shadow-[var(--mf-shadow-pop)] focus-within:border-primary/40">
        {/* Header */}
        <div className="flex items-center gap-[6px] [border-bottom:0.5px_solid_var(--border)] px-[10px] py-[6px]">
          <span className="text-caption font-semibold text-muted-foreground">Agent context</span>
          {lineNumber !== undefined && (
            <span className="font-mono text-micro text-mf-text-4">line {lineNumber}</span>
          )}
          <div className="flex-1" />
          <button
            data-testid="editor-comment-widget-close"
            type="button"
            onClick={onClose}
            title="Close"
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border-none bg-transparent text-mf-text-3 hover:bg-accent"
          >
            <X size={10} aria-hidden />
          </button>
        </div>

        {/* Textarea */}
        <textarea
          data-testid="editor-comment-widget-input"
          ref={ref}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what the agent should know about this line…"
          className="w-full min-h-[52px] resize-none border-0 bg-transparent px-[11px] py-[9px] text-body text-foreground outline-none focus:outline-none focus-visible:outline-none"
          style={{ boxSizing: 'border-box', overflowX: 'hidden', overflowY: 'auto', whiteSpace: 'pre-wrap' }}
        />

        {/* Footer */}
        <div className="flex items-center gap-[6px] [border-top:0.5px_solid_var(--border)] px-[9px] py-[6px]">
          <span className="font-mono text-micro text-mf-text-4">⌘↩ to add</span>
          <div className="flex-1" />
          <button
            data-testid="editor-comment-widget-cancel"
            type="button"
            onClick={onClose}
            className="h-[24px] rounded-[6px] px-[8px] text-caption text-muted-foreground [border:0.5px_solid_var(--border)] bg-transparent hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="editor-comment-widget-save"
            type="button"
            onClick={handleSave}
            disabled={!text.trim()}
            className="h-[24px] rounded-[6px] border-none bg-primary px-[8px] text-caption font-semibold text-white disabled:opacity-40 transition-opacity"
          >
            Add context
          </button>
        </div>
      </div>
    </div>
  );
}
