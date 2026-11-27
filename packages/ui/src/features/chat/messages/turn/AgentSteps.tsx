/**
 * Another agent's work inside this transcript: what it was asked, its steps as
 * rows, what it answered. Everything else its transcript holds (an error, a
 * system message, a follow-up with its images) is drawn by the component that
 * draws it in a chat, in its place. Only the message the Prompt block already
 * shows is left out.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ReadonlyThreadProvider, ThreadPrimitive, useAuiState, type ThreadMessage } from '@assistant-ui/react';
import { buildTurns } from '../../view-model/turn/build-turns';
import { NestedFailedOpen } from './use-failed-open';
import { useNestedLiveChildren } from './use-live-children';
import { SkillMatcher } from '../../view-model/turn/skill-matcher';
import { absorbedTaskResults, taskResultsIn } from '../../view-model/turn/task-results';
import { answerUnits } from '../../view-model/turn/turn-roles';
import { messageMeta, messageUnits } from '../../view-model/turn/turn-units';
import type { LoadedSkill, TurnScope, TurnUnit } from '../../view-model/turn/types';
import { visibleMessageText } from '../../markers/message-markers';
import { parseAgentMessage } from '../../markers/agent-message';
import { boundedMessageComponents } from '../bounded-messages';
import { MessageRenderBoundary } from '../MessageRenderBoundary';
import { AssistantMessage } from '../AssistantMessage';
import { NestedTranscriptProvider } from '../nested-transcript-context';
import type { AgentOutcome } from './agent-outcome';
import { Prose } from './Prose';
import { StepList } from './StepList';
import { NestedTranscriptScope, useTranscriptScope, type NestedScope } from './transcript-scope';
import { NestedSkills } from './turn-context';

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

export interface AgentStepsProps extends Omit<NestedScope, 'live' | 'cancelled'> {
  messages: readonly ThreadMessage[];
  outcome: AgentOutcome;
  prompt?: string;
  promptLabel?: string;
  /** What came back through the call or a delivered message. */
  result?: string;
  /** Drawn in place of `result`'s text: one the daemon cut short, with the rest on request. */
  resultBody?: ReactNode;
  /** Between the steps and the result: a pending request, an earlier-messages line. */
  before?: ReactNode;
  after?: ReactNode;
  /** The steps alone: what was asked and what came back are shown around them. */
  bare?: boolean;
  /** The held steps stop before the agent's end (its newest pages were dropped): none of them is its answer. */
  endsEarly?: boolean;
}

const normal = (text: string) => text.replace(/\s+/g, ' ').trim();

function userText(message: ThreadMessage): string {
  const text = visibleMessageText(
    message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
  );
  return parseAgentMessage(text)?.body ?? text;
}

/** A user message that says nothing but its text: no image, attachment or card is lost with it. */
function onlyText(message: ThreadMessage): boolean {
  const meta = messageMeta(message);
  return (
    message.content.every((part) => part.type === 'text') &&
    !message.attachments?.length &&
    !meta?.reviewComment &&
    !meta?.command &&
    !meta?.error
  );
}

/** The message that says what the Prompt block shows. A bounded window may start long after it. */
function promptMessage(messages: readonly ThreadMessage[], prompt: string | undefined): ThreadMessage | undefined {
  const first = messages.find((message) => message.role === 'user');
  if (!first || !onlyText(first)) return undefined;
  if (prompt) return normal(userText(first)) === normal(prompt) ? first : undefined;
  return first === messages[0] && !taskResultsIn(first).length ? first : undefined;
}

interface Nested {
  readonly units: ReadonlyMap<string, readonly TurnUnit[]>;
  /** Messages another element of this transcript shows. */
  readonly absorbed: ReadonlySet<string>;
  readonly skills: ReadonlyMap<string, LoadedSkill>;
  readonly answer: ReadonlySet<TurnUnit>;
  /** The answer's texts, in order. */
  readonly answerTexts: readonly string[];
}

function nest(messages: readonly ThreadMessage[], scope: TurnScope, endsEarly = false): Nested {
  const units = new Map(messages.map((message) => [message.id, messageUnits(message, scope)]));
  const skills = new SkillMatcher();
  const seen: TurnUnit[] = [];
  for (const message of messages) {
    const loaded = message.role === 'system' ? messageMeta(message)?.skillLoaded : undefined;
    if (loaded) skills.claim(message.id, loaded, seen);
    seen.push(...units.get(message.id)!);
  }
  let start = messages.length;
  while (!endsEarly && start > 0 && messages[start - 1]!.role !== 'user') start--;
  const tail = messages.slice(start).flatMap((message) => units.get(message.id)!);
  // A picture the agent answered with stays among its steps; only text moves to the Result block.
  const answer = new Set([...answerUnits(tail, false)].filter(({ part }) => part.type === 'text'));
  const answerTexts = tail.flatMap((unit) => (answer.has(unit) && unit.part.type === 'text' ? [unit.part.text] : []));
  return {
    units,
    absorbed: new Set([...skills.absorbedBy.keys(), ...absorbedTaskResults(messages).keys()]),
    skills: skills.byCall,
    answer,
    answerTexts,
  };
}

interface NestedView {
  /** The steps a message of the agent's contributes. */
  readonly steps: ReadonlyMap<string, readonly TurnUnit[]>;
  readonly hidden: ReadonlySet<string>;
}
const View = createContext<NestedView>({ steps: new Map(), hidden: new Set() });

function useShown(): { id: string; view: NestedView; shown: boolean } {
  const id = useAuiState((s) => s.message.id);
  const view = useContext(View);
  return { id, view, shown: !view.hidden.has(id) };
}

function NestedUser() {
  return useShown().shown ? <boundedMessageComponents.UserMessage /> : null;
}
function NestedSystem() {
  return useShown().shown ? <boundedMessageComponents.SystemMessage /> : null;
}
function NestedAssistant() {
  const { id, view } = useShown();
  const failed = useAuiState((s) => {
    const meta = s.message.metadata?.custom?.mainframe as { errorText?: string } | undefined;
    return Boolean(meta?.errorText);
  });
  return (
    <MessageRenderBoundary>
      {failed ? <AssistantMessage /> : <StepList units={view.steps.get(id) ?? []} />}
    </MessageRenderBoundary>
  );
}
const components = { UserMessage: NestedUser, AssistantMessage: NestedAssistant, SystemMessage: NestedSystem };

/** Whether the agent's own last words say all that was delivered: it is their end, block for block. */
function saysAll(own: readonly string[], delivered: string): boolean {
  return own.some((_, start) => normal(own.slice(start).join('\n\n')) === delivered);
}

interface ResultView {
  readonly text: string;
  /** The text is the transcript's own, so it leaves the steps. */
  readonly own: boolean;
  /** The text is what was delivered. */
  readonly delivered: boolean;
  readonly label: string;
}

/**
 * What the Result block says. What was delivered is never hidden: the agent's
 * own words replace it only when they say all of it, and leave the steps only
 * when the block repeats them from its start.
 */
function resultView(outcome: AgentOutcome, answer: readonly string[], result: string): ResultView {
  const label = outcome === 'failed' ? 'Error' : 'Result';
  const text = answer.join('\n\n');
  const [own, delivered] = [normal(text), normal(result)];
  if (outcome === 'done' && own) {
    if (!delivered || saysAll(answer, delivered)) return { text, own: true, delivered: false, label };
    return { text: result, own: delivered.startsWith(`${own} `), delivered: true, label };
  }
  // Going again after it once finished: what it brought back then stays readable.
  if (outcome === 'going')
    return {
      text: saysAll(answer, delivered) ? '' : result,
      own: false,
      delivered: true,
      label: 'Earlier result',
    };
  return { text: result, own: false, delivered: true, label };
}

/** The steps of a tab that shows the call's own text itself (W8): only words that text repeats whole leave them. */
function bareView(answer: readonly string[], result: string): ResultView {
  const own = normal(answer.join('\n\n'));
  return { text: '', own: own !== '' && own === normal(result), delivered: true, label: '' };
}

function Steps({
  messages,
  outcome,
  prompt,
  promptLabel = 'Prompt',
  result = '',
  bare,
  endsEarly = false,
  ...rest
}: AgentStepsProps) {
  const scope = useTranscriptScope();
  const isRunning = outcome === 'going';
  const model = useMemo(() => buildTurns(messages, { ...scope, isRunning }), [messages, scope, isRunning]);
  const children = useNestedLiveChildren(model);
  const disclosure = useMemo(() => ({ model, children }), [model, children]);
  const nested = useMemo(() => nest(messages, scope, endsEarly), [messages, scope, endsEarly]);
  const first = useMemo(
    () => (bare && !prompt ? undefined : promptMessage(messages, prompt)),
    [messages, prompt, bare],
  );
  const asked = prompt || (first ? userText(first) : '');
  const { text, own, delivered, label } = bare
    ? bareView(nested.answerTexts, result)
    : resultView(outcome, nested.answerTexts, result);
  const view = useMemo<NestedView>(() => {
    const steps = [...nested.units].map(
      ([id, units]) => [id, own ? units.filter((unit) => !nested.answer.has(unit)) : units] as const,
    );
    return { steps: new Map(steps), hidden: new Set([...nested.absorbed, ...(first ? [first.id] : [])]) };
  }, [nested, own, first]);
  return (
    <div data-testid="chat-agent-steps" className="flex min-w-0 flex-col">
      {asked && !bare && (
        <Block label={promptLabel} testId="chat-agent-prompt">
          <Prose text={asked} />
        </Block>
      )}
      {rest.before}
      <View.Provider value={view}>
        <NestedSkills.Provider value={nested.skills}>
          <ReadonlyThreadProvider messages={messages}>
            <NestedFailedOpen.Provider value={disclosure}>
              <ThreadPrimitive.Messages components={components} />
            </NestedFailedOpen.Provider>
          </ReadonlyThreadProvider>
        </NestedSkills.Provider>
      </View.Provider>
      {rest.after}
      {text && (
        <Block label={label} tone={label === 'Error' ? 'fail' : undefined} testId="chat-agent-result">
          {delivered && rest.resultBody ? rest.resultBody : <Prose text={text} />}
        </Block>
      )}
    </div>
  );
}

export function AgentSteps(props: AgentStepsProps) {
  const { messageId, toolCallId, chatId, pendingToolIds } = props;
  return (
    <NestedTranscriptScope
      messageId={messageId}
      toolCallId={toolCallId}
      chatId={chatId}
      pendingToolIds={pendingToolIds}
      live={props.outcome === 'going'}
      cancelled={props.outcome === 'stopped'}
    >
      <NestedTranscriptProvider>
        <Steps {...props} />
      </NestedTranscriptProvider>
    </NestedTranscriptScope>
  );
}
