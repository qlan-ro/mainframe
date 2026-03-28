import { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface InlineCommentWidgetProps {
  startLine: number;
  endLine: number;
  lineContent: string;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function InlineCommentWidget({
  startLine,
  endLine,
  lineContent,
  text,
  onTextChange,
  onSubmit,
  onClose,
}: InlineCommentWidgetProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit();
  };

  const isRange = startLine !== endLine;
  const label = isRange ? `L${startLine}-L${endLine}` : `L${startLine}`;
  const preview = lineContent.trim();

  return (
    <div className="pl-2 pr-4 py-1">
      <div className="text-mf-small font-mono text-mf-text-secondary opacity-60 mb-1">
        <span>{label}</span>
        {preview && (
          <span
            className={`ml-1 ${isRange ? 'block mt-0.5 whitespace-pre-wrap max-h-24 overflow-y-auto' : 'truncate'}`}
          >
            {isRange ? preview : `: ${preview}`}
          </span>
        )}
      </div>
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
        className="w-full h-[54px] resize-none bg-mf-input-bg border border-mf-divider rounded-md px-3 py-2 text-[13px] font-mono text-mf-text-primary focus:outline-none focus:border-mf-accent/50"
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-mf-text-secondary opacity-40">Enter to send · Shift+Enter for newline</span>
        <div className="flex items-center gap-2">
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
    </div>
  );
}
