import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

export interface InlineCommentState {
  line: number;
  lineContent: string;
  top: number;
}

export function InlineCommentWidget({
  line,
  lineContent,
  onSubmit,
  onClose,
}: {
  line: number;
  lineContent: string;
  onSubmit: (comment: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
  };

  return (
    <div className="pl-2 pr-4 py-1">
      <div className="text-mf-small font-mono text-mf-text-secondary truncate opacity-60 mb-1">
        L{line}: {lineContent.trim()}
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Add context about this line..."
        className="w-full h-[54px] resize-none bg-mf-input-bg border border-mf-divider rounded-md px-3 py-2 text-[13px] font-mono text-mf-text-primary focus:outline-none focus:border-mf-accent/50"
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-mf-text-secondary opacity-40">
          {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter to send
        </span>
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
