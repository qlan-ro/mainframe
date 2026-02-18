import React, { useState, useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';

interface LineCommentPopoverProps {
  filePath: string;
  line: number;
  lineContent: string;
  anchorRect: { top: number; left: number };
  onSubmit: (comment: string) => void;
  onClose: () => void;
}

export function LineCommentPopover({
  filePath,
  line,
  lineContent,
  anchorRect,
  onSubmit,
  onClose,
}: LineCommentPopoverProps): React.ReactElement {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  const shortPath = filePath.split('/').slice(-3).join('/');
  const trimmedLine = lineContent.trim();

  // Clamp popover within viewport
  const top = Math.min(anchorRect.top, window.innerHeight - 260);
  const left = anchorRect.left + 20;

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 w-[380px] rounded-lg border border-mf-divider bg-mf-sidebar shadow-xl shadow-black/40"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-mf-divider">
        <span className="font-mono text-mf-small text-mf-text-secondary" title={filePath}>
          {shortPath}:{line}
        </span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary">
          <X size={14} />
        </button>
      </div>

      {trimmedLine && (
        <div className="px-3 py-1.5 border-b border-mf-divider bg-mf-input-bg/30">
          <code className="text-mf-small text-mf-text-secondary font-mono block truncate" title={trimmedLine}>
            {trimmedLine}
          </code>
        </div>
      )}

      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Add a comment..."
          className="w-full h-20 resize-none rounded-md border border-mf-divider bg-mf-input-bg px-2.5 py-2 text-mf-body font-mono text-mf-text-primary placeholder-mf-text-secondary/40 focus:outline-none focus:border-mf-accent/50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-mf-text-secondary opacity-40">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to submit
          </span>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mf-accent/20 text-mf-accent text-mf-small font-medium hover:bg-mf-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={12} />
            Send to composer
          </button>
        </div>
      </div>
    </div>
  );
}
