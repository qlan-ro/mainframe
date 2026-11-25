/**
 * One assistant message of a turn: the turn's work row when the message opens
 * it, its steps, its markers under them, its answer, and the turn's footer.
 *
 * Every entry is a keyed sibling in one list, in that order. A text that turns
 * from answer into step moves among its siblings and keeps its element, so a
 * selection in it survives the next tool call.
 */
import { memo, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import type { SingleStep, Step } from '../../view-model/turn/group-steps';
import type { MessageSlice } from '../../view-model/turn/types';
import { cn } from '@/lib/utils';
import { EventMarker } from '../../tools/markers/EventMarker';
import { MessageFooter } from '../MessageFooter';
import { MessagePathContextMenu } from '../MessagePathContextMenu';
import { StepEntry, useSteps } from './StepList';
import { TextUnit } from './TextUnit';
import { WorkHeader, workId } from './WorkHeader';
import { TranscriptScopeProvider, useTranscriptScope } from './transcript-scope';
import { useTurnSelector } from './turn-context';

/** Text is drawn by the same element as a step and as the answer, so it isn't remounted between them. */
const isText = (step: Step): step is SingleStep => step.type === 'single' && step.unit.part.type === 'text';

function useEntries(slice: MessageSlice): ReactNode[] {
  const turn = useTurnSelector(({ model }) => model.turns.get(slice.turnKey), undefined);
  const open = useTurnSelector((state) => state.open(slice.turnKey), true);
  const steps = useSteps(slice.work, turn?.running);
  const entries: ReactNode[] = [];
  if (slice.header && turn) entries.push(<WorkHeader key="header" turn={turn} />);
  if (open)
    for (const [index, step] of steps.entries())
      entries.push(
        <div
          key={step.key}
          id={slice.header && index === 0 ? workId(slice.turnKey) : undefined}
          data-work-turn={slice.turnKey}
          className="min-w-0 pl-5.5"
        >
          {isText(step) ? <TextUnit unit={step.unit} step /> : <StepEntry step={step} turnKey={slice.turnKey} />}
        </div>,
      );
  for (const unit of slice.markers)
    if (unit.part.type === 'tool-call')
      entries.push(
        <div key={unit.key} className="min-w-0 py-[3px]">
          <EventMarker unit={unit} part={unit.part} />
        </div>,
      );
  for (const unit of slice.answer)
    entries.push(
      <div key={unit.key} className="min-w-0">
        <TextUnit unit={unit} />
      </div>,
    );
  return entries;
}

function SliceBody({ slice }: { slice: MessageSlice }) {
  const entries = useEntries(slice);
  const empty = entries.length === 0 && !slice.footer;
  return (
    <MessagePrimitive.Root
      data-testid="chat-assistant-message"
      data-message-id={slice.messageId}
      data-tr-message
      // Never empty for real: the virtualized list can't measure a zero-height row.
      className={cn('flex min-w-0 flex-col', empty && 'h-px', slice.footer && 'pb-1')}
    >
      <MessagePathContextMenu>{entries}</MessagePathContextMenu>
      {slice.footer && <MessageFooter />}
    </MessagePrimitive.Root>
  );
}

export const TurnSlice = memo(function TurnSlice({ slice }: { slice: MessageSlice }) {
  const parent = useTranscriptScope();
  const messageId = useAuiState((s) => s.message.id);
  const live = useTurnSelector(({ model }) => model.turns.get(slice.turnKey)?.live ?? false, true);
  const scope = useMemo(() => ({ ...parent, messageId, live }), [parent, messageId, live]);
  return (
    <TranscriptScopeProvider value={scope}>
      <SliceBody slice={slice} />
    </TranscriptScopeProvider>
  );
});
