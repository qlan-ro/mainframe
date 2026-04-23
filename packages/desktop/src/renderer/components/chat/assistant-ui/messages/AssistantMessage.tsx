import React from 'react';
import { Bot } from 'lucide-react';
import { MessagePrimitive, useMessage } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import { MainframeText } from '../parts/MainframeText';
import { DefaultToolCard } from '../parts/tools/DefaultToolCard';
import { TurnFooter } from './TurnFooter';
import { ImageThumbs } from './ImageThumbs';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';

export function AssistantMessage() {
  const message = useMessage();
  const { openLightbox } = useMainframeRuntime();

  const [original] = getExternalStoreMessages<DisplayMessage>(message);
  const imageBlocks = (original?.content?.filter((c): c is DisplayContent & { type: 'image' } => c.type === 'image') ??
    []) as { type: 'image'; mediaType: string; data: string }[];

  return (
    <MessagePrimitive.Root className="group relative">
      <div className="flex gap-3">
        <div className="w-6 h-6 rounded-full bg-mf-accent/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-mf-accent" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <MessagePrimitive.Parts
            components={{
              Text: MainframeText,
              Reasoning: () => null,
              tools: {
                Fallback: ({ toolName, args, argsText, result, isError }) => (
                  <DefaultToolCard
                    toolName={toolName}
                    args={(args || {}) as Record<string, unknown>}
                    argsText={argsText}
                    result={result}
                    isError={isError}
                  />
                ),
              },
            }}
          />
          <ImageThumbs imageBlocks={imageBlocks} openLightbox={openLightbox} />
          <TurnFooter />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}
