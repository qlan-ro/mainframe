'use client';

/**
 * AskUserQuestionCard — display card for the 'AskUserQuestion' tool.
 *
 * Shows a compact collapsible chip: MessageCircleQuestion icon + first question
 * header text + short inline answer for single-question flows.
 *
 * Body: per-question answer chips (answer label pills, notes, preview).
 * Collapsed by default; disabled when no result yet.
 *
 * NOTE: This is the DISPLAY card only — the interactive ask-user-question card
 * (permission gate / answer form) is a separate leaf built in the permissions
 * surface. This card renders the answered / pending read-only state inside the
 * message thread.
 */

import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { MessageCircleQuestion, Check } from 'lucide-react';
import type { AskUserQuestionAnswer } from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { StatusDot } from '../shared';
import { useAutoOpenOnTransition } from './use-auto-open-on-transition';

// ── Question type (local — matches args.questions[] shape) ────────────────────

interface QuestionArg {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

// ── Type guard: ToolCallResult with askUserQuestion ───────────────────────────

interface ResultWithAnswers {
  askUserQuestion: AskUserQuestionAnswer[];
}

function isResultWithAnswers(result: unknown): result is ResultWithAnswers {
  return (
    typeof result === 'object' &&
    result !== null &&
    'askUserQuestion' in result &&
    Array.isArray((result as Record<string, unknown>)['askUserQuestion'])
  );
}

// ── AnswerPills ───────────────────────────────────────────────────────────────

function AnswerPills({ options, answer }: { options: { label: string }[]; answer: string[] }) {
  if (answer.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 ml-2">
      {answer.map((label) => {
        const known = options.some((o) => o.label === label);
        return (
          <span
            key={label}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption',
              known
                ? 'bg-mf-content2 text-primary border border-border'
                : 'bg-card text-muted-foreground border border-border opacity-60',
            )}
          >
            <Check size={11} className="shrink-0" />
            {label}
          </span>
        );
      })}
    </div>
  );
}

// ── AnswerEntry ───────────────────────────────────────────────────────────────

function AnswerEntry({ entry, question }: { entry: AskUserQuestionAnswer; question: QuestionArg | undefined }) {
  return (
    <div className="space-y-1.5">
      <p data-testid="chat-ask-question-text" className="text-caption text-foreground">
        {entry.question}
      </p>
      <AnswerPills options={question?.options ?? []} answer={entry.answer} />
      {entry.notes && (
        <p data-testid="chat-ask-answer-notes" className="text-caption text-muted-foreground ml-2">
          {entry.notes}
        </p>
      )}
      {entry.preview && (
        <p data-testid="chat-ask-answer-preview" className="text-caption text-muted-foreground ml-2">
          {entry.preview}
        </p>
      )}
    </div>
  );
}

// ── PendingQuestion ───────────────────────────────────────────────────────────

function PendingQuestion({ question }: { question: QuestionArg }) {
  return (
    <div>
      <p className="text-caption text-muted-foreground">{question.question}</p>
    </div>
  );
}

// ── AskUserQuestionCard ───────────────────────────────────────────────────────

export const AskUserQuestionCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError } = part;

  const questions = (args['questions'] as QuestionArg[] | undefined) ?? [];
  const answered = isResultWithAnswers(result);
  const askUserQuestion: AskUserQuestionAnswer[] = answered ? result.askUserQuestion : [];

  const firstQuestion = questions[0];
  const firstHeader = firstQuestion?.header ?? 'Question';

  // Inline short answer for single-question flows
  const firstAnswer = askUserQuestion[0];
  const shortAnswerText = answered && questions.length === 1 && firstAnswer ? firstAnswer.answer.join(', ') : undefined;

  const hasBody = answered ? askUserQuestion.length > 0 : questions.length > 0;
  const [open, setOpen] = useAutoOpenOnTransition(answered);

  return (
    <Collapsible data-testid="chat-ask-card" open={open} onOpenChange={setOpen} disabled={!hasBody}>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Header trigger */}
        <CollapsibleTrigger
          data-testid="chat-ask-trigger"
          disabled={!hasBody}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left',
            hasBody ? 'hover:bg-accent transition-colors cursor-pointer' : 'cursor-default',
          )}
        >
          <MessageCircleQuestion size={15} className="shrink-0 text-primary" />
          <span data-testid="chat-ask-header" className="text-body text-muted-foreground flex-1 truncate min-w-0">
            {firstHeader}
            {shortAnswerText && (
              <span className="text-foreground opacity-70">
                {' — '}
                {shortAnswerText}
              </span>
            )}
          </span>
          <StatusDot result={result} isError={isError} />
        </CollapsibleTrigger>

        {/* Collapsible body */}
        {hasBody && (
          <CollapsibleContent>
            <div data-testid="chat-ask-body" className="px-3 py-2 space-y-3 border-t border-border">
              {askUserQuestion.length > 0
                ? askUserQuestion.map((entry, i) => {
                    const question = questions.find((q) => q.question === entry.question) ?? questions[i];
                    return <AnswerEntry key={entry.question} entry={entry} question={question} />;
                  })
                : questions.map((q) => <PendingQuestion key={q.question} question={q} />)}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
};

AskUserQuestionCard.displayName = 'AskUserQuestionCard';
