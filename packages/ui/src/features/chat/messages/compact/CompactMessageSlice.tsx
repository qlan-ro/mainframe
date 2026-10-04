import { createContext, memo, useContext, useMemo } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState, type ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import type { DisplayUnit, SourceUnit, MessagePresentation } from '../../view-model/compact/turn-types';
import { hasActivityDetail } from '../../view-model/compact/activity-details';
import { isFullCard } from '../../view-model/compact/tool-kind';
import { MessageToolLeaf } from '../../tools/tool-dispatch';
import { ZoomableImage } from '../../parts/ZoomableImage';
import { MessageActionBar } from '../MessageActionBar';
import { MessageTiming } from '../MessageTiming';
import { MessageTimestamp } from '../MessageTimestamp';
import { MessagePathContextMenu } from '../MessagePathContextMenu';
import { useIsNestedTranscript } from '../nested-transcript-context';
import { CompactActivityGroup, CompactDetailRows } from './CompactActivityGroup';
import { CompactTextSlice } from './CompactTextSlice';
import { CompactTurnDisclosure, workSlotId } from './CompactTurnDisclosure';
import { TranscriptScopeProvider, useTranscriptScope } from './transcript-scope';
import { useTurnPresentation } from './turn-presentation-context';

const ToolLeaf: ToolCallMessagePartComponent = (part) => <MessageToolLeaf part={{ ...part, toolUI: null }} />;
const nativeComponents = {
  tools: { Override: ToolLeaf },
  Image: ({ image }: { image: string }) => (
    <ZoomableImage src={image} className="max-h-80 max-w-full rounded-md border border-border object-contain" />
  ),
};
const Detail = createContext<{ unit: SourceUnit; footer: boolean; timing: boolean } | null>(null);
function SourceDetail() {
  const { unit, footer, timing } = useContext(Detail)!;
  const indices = useMemo(() => [unit.index], [unit.index]);
  const parent = useTranscriptScope();
  const scope = useMemo(() => ({ ...parent, messageId: unit.messageId }), [parent, unit.messageId]);
  return (
    <TranscriptScopeProvider value={scope}>
      <MessagePrimitive.Root data-source-message-id={unit.messageId}>
        <CompactDetailRows indices={indices} nested />
        {footer && (
          <MessageFooter className="min-h-6 gap-2 px-0">
            <MessageActionBar />
            <MessageTimestamp />
            <MessageTiming suppressDuration={!!timing} />
          </MessageFooter>
        )}
      </MessagePrimitive.Root>
    </TranscriptScopeProvider>
  );
}
const detailComponents = { AssistantMessage: SourceDetail, UserMessage: () => null };
const ScopedDetail = memo(function ScopedDetail({
  unit,
  footer,
  timing,
}: {
  unit: SourceUnit;
  footer: boolean;
  timing: boolean;
}) {
  const value = useMemo(() => ({ unit, footer, timing }), [unit, footer, timing]);
  return (
    <Detail.Provider value={value}>
      <ThreadPrimitive.Unstable_MessageById messageId={unit.messageId} components={detailComponents} />
    </Detail.Provider>
  );
});
function ActivityDetails({ members }: { members: readonly SourceUnit[] }) {
  const { model } = useTurnPresentation();
  const { pendingToolIds } = useTranscriptScope();
  const visibleMembers = useMemo(
    () => members.filter((unit) => hasActivityDetail(unit.part, pendingToolIds)),
    [members, pendingToolIds],
  );
  const lastSources = useMemo(() => new Map(visibleMembers.map((unit) => [unit.messageId, unit])), [visibleMembers]);
  return (
    <>
      {visibleMembers.map((unit) => {
        const source = model.messagesById.get(unit.messageId);
        return (
          <ScopedDetail
            key={unit.key}
            unit={unit}
            footer={lastSources.get(unit.messageId) === unit && source?.footerInDetails === true}
            timing={!!source?.timingTurnKey}
          />
        );
      })}
    </>
  );
}
const Content = memo(function Content({ unit }: { unit: DisplayUnit }) {
  if (unit.activity)
    return (
      <CompactActivityGroup group={unit.activity.group} details={<ActivityDetails members={unit.activity.members} />} />
    );
  if (unit.part.type === 'text' || unit.part.type === 'reasoning') return <CompactTextSlice unit={unit} />;
  if (unit.part.type === 'tool-call' && !isFullCard(unit.part.toolName))
    return <CompactDetailRows indices={[unit.index]} />;
  return <MessagePrimitive.PartByIndex index={unit.index} components={nativeComponents} />;
});
function Slot({ unit }: { unit: DisplayUnit }) {
  const state = useTurnPresentation();
  const turn = unit.turnKey && state.model.turns.get(unit.turnKey);
  const header = !!turn && turn.available && turn.firstWorkKey === unit.key;
  const hidden = unit.work && !!turn && !state.open(turn.key);
  return (
    <>
      {header && <CompactTurnDisclosure turn={turn} />}
      <div id={workSlotId(unit.key)} data-work-turn={unit.work ? unit.turnKey : undefined} hidden={hidden}>
        {!hidden && <Content unit={unit} />}
      </div>
    </>
  );
}
function SliceBody({ presentation }: { presentation: MessagePresentation }) {
  const state = useTurnPresentation();
  const nested = useIsNestedTranscript();
  const visible = presentation.units.some((unit) => !unit.work || !unit.turnKey || state.open(unit.turnKey));
  const header = presentation.units.some((unit) => {
    const turn = unit.turnKey && state.model.turns.get(unit.turnKey);
    return turn && turn.available && turn.firstWorkKey === unit.key;
  });
  const parts = presentation.units.map((unit) => <Slot key={unit.key} unit={unit} />);
  return (
    <MessagePrimitive.Root
      data-testid="chat-assistant-message"
      data-message-id={presentation.messageId}
      hidden={!visible && !header}
      className="py-2"
    >
      <Message>
        <MessageContent>
          {nested ? parts : <MessagePathContextMenu>{parts}</MessagePathContextMenu>}
          {visible && !presentation.footerInDetails && (
            <MessageFooter className="min-h-6 gap-2 px-0">
              <MessageActionBar />
              <MessageTimestamp />
              <MessageTiming suppressDuration={!!presentation.timingTurnKey} />
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    </MessagePrimitive.Root>
  );
}
export function CompactMessageSlice({ presentation }: { presentation: MessagePresentation }) {
  const parent = useTranscriptScope();
  const messageId = useAuiState((s) => s.message.id);
  const scope = useMemo(() => ({ ...parent, messageId }), [parent, messageId]);
  return (
    <TranscriptScopeProvider value={scope}>
      <SliceBody presentation={presentation} />
    </TranscriptScopeProvider>
  );
}
