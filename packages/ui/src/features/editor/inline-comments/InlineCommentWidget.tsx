/**
 * InlineCommentWidget — the React card rendered inside a CM6 block decoration.
 *
 * Mounted via createPortal into a DOM node that CM6's decoration system
 * injects below the annotated line. The parent (CmEditor with comment support)
 * owns the portal host element and manages add/edit/delete state through
 * useInlineComments.
 *
 * Anatomy:
 *   Header row: Sparkles icon (text-primary) + "Review comment" + range label
 *     (mono) + close button
 *   Snippet block (when lineContent provided): bg-muted, SnippetLines rows
 *   Card: shadow-md, accent border when editing (focus-within:border-primary/40)
 *   Textarea: ⌘↩ to submit
 *   Footer: "⌘↩ to add" hint + Cancel + "Add context" + Send
 *
 * Props:
 *   text          — current textarea value (controlled)
 *   lineNumber    — 1-based line number of the annotated line (optional display)
 *   endLine       — 1-based end line for a multi-line range (optional)
 *   lineContent   — preview of the annotated code line(s) (optional context)
 *   onTextChange  — controlled input handler
 *   onSave        — called on ⌘↩ or "Add context" button click (when text is non-empty)
 *   onClose       — called on Escape or Cancel button click
 *   onDelete      — if provided, the widget supports deletion
 *   onSend        — if provided, shows a Send button that fires when text is non-empty
 */
import { useEffect, useRef } from 'react';
import { Send, Sparkles, X } from 'lucide-react';
import { SnippetLines, rangeLabel } from '@/features/chat/messages/code-snippet';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { Textarea } from '@v2/components/ui/textarea';

export interface InlineCommentWidgetProps {
  text: string;
  lineNumber?: number;
  endLine?: number;
  lineContent?: string;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onSend?: () => void;
}

export function InlineCommentWidget({
  text,
  lineNumber,
  endLine,
  lineContent,
  onTextChange,
  onSave,
  onClose,
  onDelete,
  onSend,
}: InlineCommentWidgetProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Silence unused-variable warning: onDelete is wired for callers that need it.
  void onDelete;

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave();
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSend?.();
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

  const lineLabel = lineNumber !== undefined ? rangeLabel({ start: lineNumber, end: endLine }) : null;

  return (
    <div data-testid="editor-comment-widget" className="flex py-[5px] pl-[14px] pr-[14px] font-sans">
      {/* Sparkles gutter indicator */}
      <div className="mr-[10px] flex w-[12px] shrink-0 items-start pt-[9px]">
        <Sparkles size={12} className="text-primary" aria-hidden />
      </div>

      {/* Card */}
      <div className="flex-1 overflow-hidden rounded-md border border-border bg-card shadow-md focus-within:border-primary/40">
        {/* Header */}
        <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Review comment</span>
          {lineLabel !== null && <span className="font-mono text-xs text-muted-foreground">{lineLabel}</span>}
          <div className="flex-1" />
          <Hint label="Close">
            <Button data-testid="editor-comment-widget-close" variant="ghost" size="icon-xs" onClick={onClose}>
              <X aria-hidden />
            </Button>
          </Hint>
        </div>

        {/* Code snippet preview */}
        {lineContent && (
          <div
            data-testid="editor-comment-widget-snippet"
            className="max-h-30 overflow-auto border-b border-border bg-muted py-1"
          >
            <SnippetLines lines={lineContent.split('\n')} start={lineNumber ?? 1} />
          </div>
        )}

        {/* Textarea — chromeless by design: the card IS the field's frame. */}
        <Textarea
          data-testid="editor-comment-widget-input"
          ref={ref}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what the agent should know about these lines…"
          className="min-h-13 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
        />

        {/* Footer */}
        <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5">
          <span className="font-mono text-xs text-muted-foreground">⌘↩ to add</span>
          <div className="flex-1" />
          <Button data-testid="editor-comment-widget-cancel" variant="outline" size="xs" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="editor-comment-widget-save" size="xs" onClick={handleSave} disabled={!text.trim()}>
            Add context
          </Button>
          {onSend !== undefined && (
            <Button data-testid="editor-comment-widget-send" size="xs" onClick={handleSend} disabled={!text.trim()}>
              <Send data-icon="inline-start" aria-hidden />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
