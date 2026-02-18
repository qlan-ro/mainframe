import React, { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import type { ReasoningMessagePartComponent } from '@assistant-ui/react';
import { cn } from '../../../../lib/utils';

export const ThinkingPart: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-mf-card bg-mf-input-bg/50 border border-mf-divider/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-mf-body hover:bg-mf-hover/30 transition-colors"
      >
        <ChevronRight
          size={14}
          className={cn('text-mf-text-secondary transition-transform duration-200', open && 'rotate-90')}
        />
        <Brain size={14} className="text-mf-accent/70" />
        <span className="font-mono text-mf-text-secondary">Thinking...</span>
      </button>

      <div
        className={cn(
          'transition-all duration-200 overflow-hidden',
          open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="border-t border-mf-divider/50 px-3 py-2">
          <pre className="text-mf-small font-mono text-mf-text-secondary opacity-70 whitespace-pre-wrap">{text}</pre>
        </div>
      </div>
    </div>
  );
};
