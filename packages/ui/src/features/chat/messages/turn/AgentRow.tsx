/** A sub-agent: its name, what it was asked, its steps as rows, and what it answered (T1c). */
import { PanelRight } from 'lucide-react';
import { useZonesStore } from '../../zones/zones-store';
import { argText } from '../../view-model/turn/tool-values';
import { rowName } from '../../view-model/turn/tool-row';
import { resolveResultText } from '../../tools/shared';
import type { ToolPart } from '../../view-model/turn/types';
import { ResultText } from '../../tools/bodies/ResultText';
import { BodyNote } from '../../tools/bodies/Surface';
import { AgentSteps } from './AgentSteps';
import { agentLaunched, agentOutcome } from './agent-outcome';
import { RowAction, RowDisclosure } from './RowDisclosure';
import { RowGlyph } from './RowGlyph';
import { useStepDuration } from './StepClock';
import { receiptText, useToolFacts, type ToolRowProps } from './ToolRow';
import { KIND_ICONS, STATUS_WORDS, type RowStatus } from './tool-icons';
import { useTranscriptScope } from './transcript-scope';
import { useTurnSelector } from './turn-context';
import { useFailedOpen } from './use-failed-open';

const WORDS: Partial<Record<RowStatus, string>> = { 'needs-you': 'waiting on you', queued: 'queued' };

/** Whether the agent's own transcript says anything. */
const answered = (part: ToolPart): boolean =>
  (part.messages ?? []).some(
    (message) =>
      message.role === 'assistant' && message.content.some((entry) => entry.type === 'text' && entry.text.trim()),
  );

function useAgentStatus(toolCallId: string, own: RowStatus): RowStatus {
  const live = useTurnSelector(({ children }) => children.byCall.get(toolCallId), undefined);
  return live ?? own;
}

export function AgentRow({ unit, part, turnKey }: ToolRowProps) {
  const facts = useToolFacts(part);
  const status = useAgentStatus(part.toolCallId, facts.status);
  const running = status === 'running';
  const duration = useStepDuration({ ...facts, running: facts.status === 'running' });
  const { chatId, rootThreadId } = useTranscriptScope();
  const openSubagent = useZonesStore((state) => state.openSubagent);
  const failed = useFailedOpen(turnKey, part.toolCallId);
  const title = facts.target || facts.verb;
  const { text, truncated } = resolveResultText(part.result);
  const launched = agentLaunched(text);
  const open = () =>
    openSubagent({
      parentChatId: chatId!,
      parentThreadId: rootThreadId,
      toolCallId: part.toolCallId,
      messageId: unit.messageId,
      title: facts.verb,
    });
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-row-${part.toolCallId}`}
      name={rowName(facts)}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS.subagent} status={status} />}
      verb={facts.verb}
      strong
      target={facts.target}
      receipt={receiptText(WORDS[status] ?? (running ? 'running' : facts.receipt), duration)}
      tone={
        status === 'failed' ? 'fail' : status === 'needs-you' || status === 'awaiting-approval' ? 'warn' : undefined
      }
      actions={
        chatId && (
          <RowAction
            label={`Open ${title} beside this chat`}
            testId={`chat-task-open-${part.toolCallId}`}
            onClick={open}
          >
            <PanelRight />
          </RowAction>
        )
      }
      defaultOpen={failed}
      steps
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      <AgentSteps
        messages={part.messages ?? []}
        messageId={unit.messageId}
        toolCallId={part.toolCallId}
        prompt={argText(part, 'prompt')}
        outcome={agentOutcome(status)}
        result={launched ? '' : text}
        resultBody={truncated && <ResultText part={part} />}
        // Started and never heard of again: all there is to say.
        after={launched && status !== 'running' && !answered(part) && <BodyNote>{text}</BodyNote>}
      />
    </RowDisclosure>
  );
}
