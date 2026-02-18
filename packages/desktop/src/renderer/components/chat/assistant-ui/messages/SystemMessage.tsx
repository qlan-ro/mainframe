import React from 'react';
import { Zap } from 'lucide-react';
import { MessagePrimitive, useMessage } from '@assistant-ui/react';

export function SystemMessage() {
  const message = useMessage();
  const textPart = message.content.find((p): p is { type: 'text'; text: string } => p.type === 'text');
  if (!textPart) return null;
  return (
    <MessagePrimitive.Root className="flex justify-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-mf-hover/50 px-4 py-1.5">
        <Zap size={12} className="text-mf-text-secondary" />
        <span className="font-mono text-[11px] text-mf-text-secondary">{textPart.text}</span>
      </div>
    </MessagePrimitive.Root>
  );
}
