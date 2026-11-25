/** An event tool on the spine: its pill, or an answered question's card (T1g). */
import { useContext, useMemo } from 'react';
import {
  Activity,
  AlarmClock,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  FolderGit2,
  FolderOutput,
  FolderX,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { EXECUTION_MODE_LABELS } from '../../messages/execution-mode-labels';
import { useStepDuration } from '../../messages/turn/StepClock';
import { useBackgroundStart } from '../../messages/turn/use-background-start';
import { useTranscriptScope } from '../../messages/turn/transcript-scope';
import { NestedSkills, useTurnSelector } from '../../messages/turn/turn-context';
import { markerFacts, type MarkerFacts, type MarkerIcon } from '../../view-model/turn/marker-facts';
import { isQuestionTool } from '../../view-model/turn/tool-kind';
import { toolRowFacts } from '../../view-model/turn/tool-row';
import type { ToolPart, TurnUnit } from '../../view-model/turn/types';
import { MarkerBodyView } from './MarkerBodyView';
import { MarkerPill } from './MarkerPill';
import { QuestionCard } from './QuestionCard';

export const MARKER_ICONS: Record<MarkerIcon, LucideIcon> = {
  skill: Zap,
  plan: ClipboardList,
  'plan-approved': ClipboardCheck,
  wakeup: AlarmClock,
  'cron-create': CalendarClock,
  'cron-delete': CalendarX,
  'cron-list': CalendarDays,
  monitor: Activity,
  'worktree-enter': FolderGit2,
  'worktree-leave': FolderOutput,
  'worktree-remove': FolderX,
  notification: Bell,
};

export function usePlanMode(): string | undefined {
  const mode = useChatExtrasSelector((extras) => extras?.state.chatConfig?.permissionMode);
  return mode ? EXECUTION_MODE_LABELS[mode] : undefined;
}

function useMarkerFacts(part: ToolPart): { facts: MarkerFacts; duration?: string } {
  const { pendingToolIds, live } = useTranscriptScope();
  const ownSkill = useContext(NestedSkills)?.get(part.toolCallId);
  const turnSkill = useTurnSelector(({ model }) => model.skills.get(part.toolCallId), undefined);
  const skill = ownSkill ?? turnSkill;
  const mode = usePlanMode();
  const startedAt = useBackgroundStart(part.toolCallId);
  const monitoring = part.toolName === 'Monitor' && startedAt !== undefined;
  const facts = useMemo(
    () => markerFacts(part, { pending: pendingToolIds, live, skill, mode, monitoring }),
    [part, pendingToolIds, live, skill, mode, monitoring],
  );
  const { timing } = toolRowFacts(part, 'success');
  const running = facts.state === 'running';
  const duration = useStepDuration({ timing: monitoring ? { startedAt } : timing, running });
  return { facts, duration: part.toolName === 'Monitor' || running ? duration : undefined };
}

function ToolMarker({ unit, part }: { unit: TurnUnit; part: ToolPart }) {
  const { facts, duration } = useMarkerFacts(part);
  return (
    <MarkerPill
      rowKey={unit.key}
      testId={`chat-marker-${part.toolName.toLowerCase()}`}
      icon={MARKER_ICONS[facts.icon]}
      label={facts.label}
      target={facts.target}
      mono={facts.mono}
      receipt={[facts.receipt, duration].filter(Boolean).join(' · ') || undefined}
      state={facts.state}
      activityId={part.toolCallId}
    >
      {facts.body && <MarkerBodyView body={facts.body} id={part.toolCallId} />}
    </MarkerPill>
  );
}

export function EventMarker({ unit, part }: { unit: TurnUnit; part: ToolPart }) {
  return isQuestionTool(part.toolName) ? <QuestionCard part={part} /> : <ToolMarker unit={unit} part={part} />;
}
