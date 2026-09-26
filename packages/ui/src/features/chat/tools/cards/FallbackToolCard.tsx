'use client';

/**
 * FallbackToolCard — the default/unregistered-tool card, extended with
 * tool-result image thumbnails (todo #363).
 *
 * Wraps the shadcn ToolFallback compound (trigger/content) unchanged, except:
 *   - a ToolResultImageThumbs row sits beside the trigger, outside its own
 *     button, so a thumbnail click/keydown never toggles the card open/closed
 *     (same header-accessory pattern as CollapsibleCardShell).
 *   - ToolFallbackResult renders only the text portion of an image-carrying
 *     result (via resolveResultText), so the base64 `images` payload never
 *     reaches the JSON.stringify fallback.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import {
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
} from '@/components/ui/assistant-ui/tool-fallback';
import { resolveResultText, resultImages, ToolResultImageThumbs } from '../shared';

export const FallbackToolCard: ToolCallMessagePartComponent = ({ toolCallId, toolName, argsText, result, status }) => {
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled';
  const images = resultImages(result);
  const { text } = resolveResultText(result);
  // An image-only result carries its text (if any) separately; never let the
  // raw result object reach ToolFallbackResult's JSON.stringify fallback.
  const resultForDisplay = images.length > 0 ? text || undefined : result;

  return (
    <ToolFallbackRoot className={cn(isCancelled && 'opacity-60')}>
      <div className="flex w-full items-center gap-2">
        <ToolFallbackTrigger toolName={toolName} status={status} className="min-w-0 flex-1" />
        {images.length > 0 && (
          <span className="mr-3 shrink-0" data-testid="chat-tool-fallback-images">
            <ToolResultImageThumbs toolCallId={toolCallId} images={images} />
          </span>
        )}
      </div>
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && 'opacity-60')} />
        {!isCancelled && <ToolFallbackResult result={resultForDisplay} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

FallbackToolCard.displayName = 'FallbackToolCard';
