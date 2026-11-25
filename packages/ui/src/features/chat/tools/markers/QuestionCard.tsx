/**
 * A question the agent asked (T1g). It is asked through the gate above the
 * composer; what stays in the transcript is the record: the question, the
 * chosen answers, the note.
 */
import { Check, MessageCircleQuestion, Pencil } from 'lucide-react';
import type { AskUserQuestionAnswer } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useTranscriptScope, type TranscriptScope } from '../../messages/turn/transcript-scope';
import { resolveResultText } from '../shared';
import { settledStatus } from '../../view-model/turn/tool-status';
import { record } from '../../view-model/turn/values';
import type { ToolPart } from '../../view-model/turn/types';
import { MarkerCard } from './MarkerPill';

interface QuestionArg {
  question: string;
  header?: string;
  options?: { label: string }[];
}

function answersOf(part: ToolPart): AskUserQuestionAnswer[] {
  const answers = record(part.result)?.askUserQuestion;
  return Array.isArray(answers) ? (answers as AskUserQuestionAnswer[]) : [];
}

function questionsOf(part: ToolPart): QuestionArg[] {
  const questions = record(part.args)?.questions;
  return Array.isArray(questions) ? (questions as QuestionArg[]) : [];
}

/** A chosen option, or the viewer's own words, which the agent never offered. */
function AnswerChip({ label, listed }: { label: string; listed: boolean }) {
  return (
    <span
      data-testid="chat-ask-answer"
      data-listed={listed}
      title={listed ? undefined : 'Written by you'}
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2',
        listed ? 'border-border bg-muted' : 'border-dashed border-input',
      )}
    >
      {listed ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-mf-tr-ok" />
      ) : (
        <Pencil aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {!listed && <span className="sr-only">Written by you: </span>}
      {label}
    </span>
  );
}

function Answer({ entry, question }: { entry: AskUserQuestionAnswer; question: QuestionArg | undefined }) {
  const header = question?.header ?? 'Question';
  const listed = (label: string) => question?.options?.some((option) => option.label === label) ?? true;
  return (
    <div role="group" aria-label={`Question, answered: ${entry.question}`} className="flex flex-col gap-1.5">
      <div data-testid="chat-ask-header" className="mf-tr-meta flex items-center gap-1.5 text-muted-foreground">
        <MessageCircleQuestion aria-hidden className="size-3.5" />
        {header} · answered
      </div>
      <p data-testid="chat-ask-question-text" className="font-medium text-foreground">
        {entry.question}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entry.answer.map((label) => (
          <AnswerChip key={label} label={label} listed={listed(label)} />
        ))}
      </div>
      {entry.notes && (
        <p data-testid="chat-ask-answer-notes" className="mf-tr-meta text-muted-foreground">
          Note: “{entry.notes}”
        </p>
      )}
      {entry.preview && (
        <p data-testid="chat-ask-answer-preview" className="mf-tr-meta text-muted-foreground">
          {entry.preview}
        </p>
      )}
    </div>
  );
}

function Unanswered({ question, state }: { question: QuestionArg; state: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div data-testid="chat-ask-header" className="mf-tr-meta flex items-center gap-1.5 text-muted-foreground">
        <MessageCircleQuestion aria-hidden className="size-3.5" />
        {question.header ?? 'Question'} · {state}
      </div>
      <p className="text-foreground">{question.question}</p>
    </div>
  );
}

/** What an unanswered question's state is: only a live turn or a pending request still waits for the viewer. */
function unansweredState(part: ToolPart, scope: TranscriptScope): string {
  if (part.result !== undefined) return 'not answered';
  const status = settledStatus(part, scope.pendingToolIds, scope.live !== false);
  return status === 'running' || status === 'awaiting-approval' ? 'waiting for your answer' : 'stopped, not answered';
}

/** Each answer with the question it answers, and the questions left without one. */
function matchAnswers(answers: readonly AskUserQuestionAnswer[], questions: readonly QuestionArg[]) {
  const asked = (text: string) => questions.find(({ question }) => question === text);
  // A question the CLI reworded is the one in its place, unless that one has its own answer.
  const taken = new Set(answers.map((entry) => asked(entry.question)));
  const answered = answers.map((entry, index) => {
    const inPlace = taken.has(questions[index]) ? undefined : questions[index];
    return { entry, question: asked(entry.question) ?? inPlace };
  });
  const matched = new Set(answered.map(({ question }) => question));
  return { answered, open: questions.filter((question) => !matched.has(question)) };
}

export function QuestionCard({ part }: { part: ToolPart }) {
  const state = unansweredState(part, useTranscriptScope());
  const answers = answersOf(part);
  const { answered, open } = matchAnswers(answers, questionsOf(part));
  const reply = resolveResultText(part.result).text;
  return (
    <div data-activity-id={part.toolCallId} className="flex w-full justify-center">
      <MarkerCard testId="chat-ask-card">
        <div className="flex flex-col gap-3">
          {answered.map(({ entry, question }) => (
            <Answer key={entry.question} entry={entry} question={question} />
          ))}
          {open.map((question) => (
            <Unanswered key={question.question} question={question} state={state} />
          ))}
          {!answers.length && reply && (
            <p data-testid="chat-ask-reply" className="mf-tr-meta wrap-break-word text-muted-foreground">
              {reply}
            </p>
          )}
        </div>
      </MarkerCard>
    </div>
  );
}
