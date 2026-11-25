/**
 * The agent's own words: its answer, or a line between steps. The same element
 * either way, so a streaming line that becomes a step keeps its text node and
 * any selection in it.
 */
import { memo } from 'react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { ImagePlus, Sparkle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatElapsedSeconds } from '../../format-duration';
import { MarkdownText } from '../../parts/markdown-text';
import { ReasoningText } from '../../parts/ReasoningText';
import { ZoomableImage } from '../../parts/ZoomableImage';
import type { TurnUnit } from '../../view-model/turn/types';
import { RowDisclosure } from './RowDisclosure';
import { RowGlyph } from './RowGlyph';
import { useReasoningDuration } from './use-reasoning-duration';

export const TextUnit = memo(function TextUnit({ unit, step = false }: { unit: TurnUnit; step?: boolean }) {
  const { part } = unit;
  if (part.type === 'image') return <Picture src={part.image} />;
  if (part.type !== 'text') return null;
  return (
    <TextMessagePartProvider text={part.text} isRunning={part.status.type === 'running'}>
      <div
        data-search-item-id={unit.itemId}
        data-testid={step ? 'chat-step-text' : 'chat-answer'}
        className={cn('min-w-0 wrap-break-word', step ? 'my-1 text-sm' : 'mf-prose mf-tr-answer mt-1.5')}
      >
        <MarkdownText {...part} />
      </div>
    </TextMessagePartProvider>
  );
});

/** A picture the agent made between steps (Codex image generation, which is no tool call). */
export function ImageRow({ unit }: { unit: TurnUnit }) {
  if (unit.part.type !== 'image') return null;
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-image-${unit.messageId}-${unit.index}`}
      name="Generated image"
      icon={<RowGlyph icon={ImagePlus} status="success" />}
      verb="Generated image"
      receipt="1 image"
    >
      <Picture src={unit.part.image} />
    </RowDisclosure>
  );
}

const Picture = ({ src }: { src: string }) => (
  <ZoomableImage src={src} className="max-h-80 max-w-full rounded-md border border-border object-contain" />
);

export function ThoughtRow({ unit }: { unit: TurnUnit }) {
  const { part } = unit;
  const running = part.status.type === 'running';
  const seconds = useReasoningDuration(running);
  if (part.type !== 'reasoning') return null;
  const verb = running
    ? 'Thinking'
    : seconds === undefined
      ? 'Thought'
      : `Thought for ${formatElapsedSeconds(seconds)}`;
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-thought-${unit.messageId}-${unit.index}`}
      name={verb}
      icon={<RowGlyph icon={Sparkle} status={running ? 'running' : 'success'} />}
      verb={verb}
    >
      <TextMessagePartProvider text={part.text} isRunning={running}>
        <p className="text-sm wrap-break-word whitespace-pre-wrap text-muted-foreground">
          <ReasoningText {...part} />
        </p>
      </TextMessagePartProvider>
    </RowDisclosure>
  );
}
