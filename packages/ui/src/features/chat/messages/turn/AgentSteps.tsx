/**
 * Another agent's work inside this transcript: what it was asked, its steps as
 * rows, what it answered. Its transcript's first user message is the prompt;
 * later ones (a follow-up round) keep their place among the steps.
 */
import { useMemo, type ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { answerUnits } from '../../view-model/turn/turn-roles';
import { messageMeta, messageUnits } from '../../view-model/turn/turn-units';
import type { TurnScope, TurnUnit } from '../../view-model/turn/types';
import { visibleMessageText } from '../../markers/message-markers';
import { parseAgentMessage } from '../../markers/agent-message';
import { CompactionPill } from '../SystemMessage';
import { NestedTranscriptProvider } from '../nested-transcript-context';
import { Prose } from './Prose';
import { StepList } from './StepList';
import { NestedTranscriptScope, useTranscriptScope } from './transcript-scope';

export function Block({
  label,
  tone,
  testId,
  children,
}: {
  label: string;
  tone?: 'fail';
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="my-0.5 min-w-0">
      <div
        className={
          tone === 'fail' ? 'mf-tr-meta font-medium text-fail' : 'mf-tr-meta font-medium text-muted-foreground'
        }
      >
        {label}
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export interface AgentStepsProps {
  messages: readonly ThreadMessage[];
  messageId: string;
  toolCallId: string;
  prompt?: string;
  promptLabel?: string;
  /** What came back, when the transcript itself doesn't end in an answer. */
  result?: string;
  failed?: boolean;
  /** Between the steps and the result: a pending request, an earlier-messages line. */
  before?: ReactNode;
  after?: ReactNode;
}

function userText(message: ThreadMessage): string {
  const text = visibleMessageText(
    message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
  );
  return parseAgentMessage(text)?.body ?? text;
}

interface Entry {
  readonly message: ThreadMessage;
  readonly units: readonly TurnUnit[];
}

function useEntries(messages: readonly ThreadMessage[]): { entries: Entry[]; answer: ReadonlySet<TurnUnit> } {
  const scope = useTranscriptScope();
  return useMemo(() => {
    const turn: TurnScope = scope;
    const entries = messages.map((message) => ({ message, units: messageUnits(message, turn) }));
    let last = entries.length - 1;
    while (last >= 0 && entries[last]!.message.role !== 'user') last--;
    return {
      entries,
      answer: answerUnits(
        entries.slice(last + 1).flatMap((entry) => entry.units),
        false,
      ),
    };
  }, [messages, scope]);
}

function Steps({ messages, prompt, promptLabel = 'Prompt', result, failed, before, after }: AgentStepsProps) {
  const { entries, answer } = useEntries(messages);
  const asked = prompt || (entries[0]?.message.role === 'user' ? userText(entries[0].message) : '');
  const answerText = [...answer]
    .flatMap(({ part }) => (part.type === 'text' ? [part.text] : []))
    .reverse()
    .join('\n\n');
  const shown = failed ? result : answerText || result;
  return (
    <div data-testid="chat-agent-steps" className="flex min-w-0 flex-col">
      {asked && (
        <Block label={promptLabel} testId="chat-agent-prompt">
          <Prose text={asked} />
        </Block>
      )}
      {before}
      {entries.map(({ message, units }, index) => {
        if (message.role === 'system')
          return messageMeta(message)?.isCompacted ? <CompactionPill key={message.id} /> : null;
        if (message.role === 'user')
          return index === 0 ? null : (
            <Block key={message.id} label="Follow-up">
              <Prose text={userText(message)} />
            </Block>
          );
        return <StepList key={message.id} units={units.filter((unit) => !answer.has(unit) || failed)} />;
      })}
      {after}
      {shown && (
        <Block label={failed ? 'Error' : 'Result'} tone={failed ? 'fail' : undefined} testId="chat-agent-result">
          <Prose text={shown} />
        </Block>
      )}
    </div>
  );
}

export function AgentSteps(props: AgentStepsProps) {
  return (
    <NestedTranscriptScope messageId={props.messageId} toolCallId={props.toolCallId}>
      <NestedTranscriptProvider>
        <Steps {...props} />
      </NestedTranscriptProvider>
    </NestedTranscriptScope>
  );
}
