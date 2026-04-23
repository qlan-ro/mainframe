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
        className="w-full h-[54px] resize-none bg-mf-input-bg border border-mf-divider rounded-md px-3 py-2 text-[13px] font-mono text-mf-text-primary focus:outline-none focus:border-mf-accent/50"
      />
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
