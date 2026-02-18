import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorPartProps {
  message: string;
}

export function ErrorPart({ message }: ErrorPartProps) {
  return (
    <div className="border border-mf-chat-error-border/30 bg-mf-chat-error-surface/20 rounded-mf-card px-3 py-2.5 flex gap-2">
      <AlertTriangle size={14} className="text-mf-chat-error shrink-0 mt-0.5" />
      <div>
        <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-chat-error block mb-1">
          Error
        </span>
        <span className="text-mf-body text-mf-text-primary">{message}</span>
      </div>
    </div>
  );
}
