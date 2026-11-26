/** A sub-agent: its name, what it was asked, its steps as rows, and what it answered (T1c). */
import { subagentFact } from '../../view-model/subagent-facts';
import { PanelRight } from 'lucide-react';
import { openSubagentTab } from '@/features/workspace-chat/conversation-tabs';
import { agentLaunched, argText } from '../../view-model/turn/tool-values';
import { rowName } from '../../view-model/turn/tool-row';
import { resolveResultText } from '../../tools/shared';
import type { ToolPart } from '../../view-model/turn/types';
import { ResultText } from '../../tools/bodies/ResultText';
import { BodyNote } from '../../tools/bodies/Surface';
import { HistoricalAgentSteps } from './HistoricalAgentSteps';
import { AgentSteps } from './AgentSteps';
import { useAgentStop, useAgentWork } from './agent-world';
import { RowAction, RowDisclosure } from './RowDisclosure';
import { RowGlyph } from './RowGlyph';
import { StopAction } from './StopAction';
import { useStepDuration } from './StepClock';
import { receiptText, useToolFacts, type ToolRowProps } from './ToolRow';
import { KIND_ICONS, STATUS_WORDS, type RowStatus } from './tool-icons';
import { useTranscriptScope } from './transcript-scope';
import { useFailedOpen } from './use-failed-open';
import { historyKey, useSubagentHistoryStore } from './subagent-history-store';

/** What the call's own receipt can't say: it may have returned before the work ended. */
const WORDS: Partial<Record<RowStatus, string>> = {
  'needs-you': 'waiting on you',
  running: 'running',
  stopped: 'stopped',
  failed: 'failed',
};

/** Whether the agent's own transcript says anything. */
const answered = (part: ToolPart): boolean =>
  (part.messages ?? []).some(
    (message) =>
      message.role === 'assistant' && message.content.some((entry) => entry.type === 'text' && entry.text.trim()),
  );

function AgentModel({ model }: { model: string }) {
  return (
    <BodyNote testId="chat-agent-model">
      Model <span className="mf-tr-mono text-foreground">{model}</span>
    </BodyNote>
  );
}

export function AgentRow({ unit, part, turnKey }: ToolRowProps) {
  const facts = useToolFacts({ unit, part });
  const { text, truncated } = resolveResultText(part.result);
  const launched = agentLaunched(text);
  const { status, outcome, standing } = useAgentWork(part);
  const historical = outcome === 'going' ? undefined : subagentFact(part);
  const own = status === facts.status;
  const duration = useStepDuration({
    ...facts,
    ...(historical?.durationMs == null ? {} : { timing: undefined, reportedDurationMs: historical.durationMs }),
    running: status === 'running' && own,
  });
  const { chatId, ancestors, parentNativeId } = useTranscriptScope();
  const historyStatus = useSubagentHistoryStore((store) => {
    if (!chatId || historical?.status !== 'unknown') return false;
    const entry = store.entries.get(historyKey(chatId, part.toolCallId));
    return entry?.error ? 'Could not load history' : entry && !entry.loading ? 'Status unavailable' : false;
  });
  const failed = useFailedOpen(turnKey, part.toolCallId, unit.key, unit.messageId);
  const title = historical?.title || facts.target || facts.verb;
  const model = argText(part, 'model');
  const word =
    standing?.label ??
    (historical && status !== 'running'
      ? (
          {
            ...WORDS,
            unknown: historyStatus || 'Open to see status',
            success: 'completed',
          } as Partial<Record<RowStatus, string>>
        )[status]
      : own && status !== 'running'
        ? facts.receipt
        : WORDS[status]);
  const { onStop, stopping } = useAgentStop(part.toolCallId, title);
  const open = () =>
    openSubagentTab({
      chatId: chatId!,
      toolCallId: part.toolCallId,
      messageId: unit.messageId,
      savedNestedLocator:
        historical && ancestors.length
          ? {
              parentNativeId: parentNativeId ?? null,
              nativeAgentId: historical.nativeAgentId ?? null,
            }
          : undefined,
      savedNestedCall:
        historical && ancestors.length
          ? {
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
              argsText: part.argsText,
              result: part.result,
              isError: part.isError,
              providerMetadata: { mainframe: { subagentFact: historical } },
            }
          : undefined,
      title: historical?.title || argText(part, 'description') || facts.verb,
    });
  const Steps = historical && chatId && status !== 'running' ? HistoricalAgentSteps : AgentSteps;
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-row-${part.toolCallId}`}
      name={rowName(facts)}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS.subagent} status={status} />}
      verb={facts.verb}
      strong
      target={historical?.title || facts.target}
      receipt={receiptText(
        word,
        duration,
        historical?.toolUseCount == null ? undefined : `${historical.toolUseCount} tools`,
        historical?.tokens == null ? undefined : `${historical.tokens} tokens`,
      )}
      tone={
        status === 'failed' ? 'fail' : status === 'needs-you' || status === 'awaiting-approval' ? 'warn' : undefined
      }
      actions={
        chatId && (
          <>
            {onStop && (
              <StopAction
                title={title}
                testId={`chat-task-stop-${part.toolCallId}`}
                stopping={stopping}
                onStop={onStop}
              />
            )}
            <RowAction
              label={`Open ${title} in the workspace`}
              testId={`chat-task-open-${part.toolCallId}`}
              onClick={open}
            >
              <PanelRight />
            </RowAction>
          </>
        )
      }
      defaultOpen={failed}
      steps
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      <Steps
        chatId={chatId ?? ''}
        messages={part.messages ?? []}
        before={model && <AgentModel model={model} />}
        messageId={unit.messageId}
        toolCallId={part.toolCallId}
        prompt={argText(part, 'prompt')}
        {...(Steps === HistoricalAgentSteps ? { nativeAgentId: historical?.nativeAgentId } : {})}
        outcome={outcome}
        result={historical?.summary ?? (launched ? '' : text)}
        resultBody={truncated && <ResultText part={part} />}
        // Started and never heard of again: all there is to say.
        after={
          !historical?.summary && launched && status !== 'running' && !answered(part) && <BodyNote>{text}</BodyNote>
        }
      />
    </RowDisclosure>
  );
}
