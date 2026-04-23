import { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface InlineCommentWidgetProps {
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function InlineCommentWidget({ text, onTextChange, onSubmit, onClose }: InlineCommentWidgetProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit();
  };

  return (
    <div className="pt-2 pb-4">
      {/*
        Wrapper owns the visual border/background and the visible padding.
        The textarea fills the padded inner area with zero padding of its
        own, because a textarea's own padding-bottom is "eaten" at scroll
        end — scrolled content would otherwise sit flush against the
        bottom border on long input.
      */}
      <div className="w-full h-[64px] bg-mf-input-bg border border-mf-divider rounded-md px-3.5 py-3 box-border focus-within:border-mf-accent/50">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Add context about this line..."
          style={{ whiteSpace: 'pre-wrap', overflowX: 'hidden', overflowY: 'auto', boxSizing: 'border-box' }}
          className="w-full h-full resize-none bg-transparent p-0 border-0 text-[13px] leading-[1.45] font-mono text-mf-text-primary focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={onClose}
          className="px-2 py-0.5 rounded text-mf-small text-mf-text-secondary hover:bg-mf-hover/50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-mf-small text-mf-accent hover:bg-mf-accent/10 disabled:opacity-30 transition-colors"
        >
          <Send size={11} />
          Send
        </button>
      </div>
    </div>
  );
}
