import { MessageCircleQuestion, Check } from 'lucide-react';
import type { AskUserQuestionAnswer, ToolCallResult } from '@qlan-ro/mainframe-types';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot } from './shared';
import { cn } from '../../../../../lib/utils';

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskUserQuestionToolCardProps {
  args: Record<string, unknown>;
  result: unknown;
}

function toToolCallResult(result: unknown): ToolCallResult | undefined {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    return result as ToolCallResult;
  }
  return undefined;
}

export function AskUserQuestionToolCard({ args, result }: AskUserQuestionToolCardProps) {
  const questions = (args.questions as Question[]) || [];
  const tcResult = toToolCallResult(result);
  const answered = tcResult !== undefined;
  const askUserQuestion: AskUserQuestionAnswer[] = tcResult?.askUserQuestion ?? [];
  const firstHeader = questions[0]?.header || 'Question';

  const firstAnswer = askUserQuestion[0];
  const shortAnswerText = answered && questions.length === 1 && firstAnswer ? firstAnswer.answer.join(', ') : undefined;

  return (
    <CollapsibleToolCard
      variant="compact"
      disabled={!answered}
      hideToggle
      wrapperClassName="border border-mf-divider rounded-mf-card overflow-hidden"
      header={
        <>
          <MessageCircleQuestion size={15} className="text-mf-accent/60 shrink-0" />
          <span className="text-mf-body text-mf-text-secondary/60">
            {firstHeader}
            {shortAnswerText ? (
              <span className="text-mf-text-primary/70">
                {' — '}
                {shortAnswerText}
              </span>
            ) : null}
          </span>
        </>
      }
      trailing={<StatusDot result={result} isError={false} />}
    >
      <div className="px-3 py-2 space-y-3">
        {askUserQuestion.length > 0
          ? askUserQuestion.map((entry, i) => {
              const question = questions.find((q) => q.question === entry.question) ?? questions[i];
              return (
                <div key={i} className="space-y-1.5">
                  <p className="text-mf-small text-mf-text-primary/80">{entry.question}</p>
                  <AnswerDisplay options={question?.options ?? []} answer={entry.answer} />
                  {entry.notes ? <p className="text-mf-small text-mf-text-secondary ml-2">{entry.notes}</p> : null}
                  {entry.preview ? <p className="text-mf-small text-mf-text-secondary ml-2">{entry.preview}</p> : null}
                </div>
              );
            })
          : questions.map((q, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-mf-small text-mf-text-primary/80">{q.question}</p>
              </div>
            ))}
      </div>
    </CollapsibleToolCard>
  );
}

function AnswerDisplay({ options, answer }: { options: { label: string }[]; answer: string[] }) {
  if (answer.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 ml-2">
      {answer.map((label) => {
        const knownOption = options.some((o) => o.label === label);
        return (
          <span
            key={label}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-mf-small',
              knownOption
                ? 'bg-mf-accent/15 text-mf-accent border border-mf-accent/30'
                : 'bg-mf-input-bg/40 text-mf-text-secondary border border-transparent opacity-40',
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
