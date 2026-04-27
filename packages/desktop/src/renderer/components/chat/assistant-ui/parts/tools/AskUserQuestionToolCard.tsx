import { MessageCircleQuestion, Check } from 'lucide-react';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot } from './shared';
import { cn } from '../../../../../lib/utils';

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionToolCardProps {
  args: Record<string, unknown>;
  result: unknown;
}

function parseAnswers(result: unknown): Record<string, string | string[]> | undefined {
  if (typeof result !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed === 'object' && parsed !== null && 'answers' in parsed) {
      return (parsed as { answers: Record<string, string | string[]> }).answers;
    }
  } catch {
    // Result is plain text — try to extract from the text
  }
  return undefined;
}

function getAnswerText(result: unknown): string | undefined {
  if (typeof result !== 'string') return undefined;
  return result;
}

export function AskUserQuestionToolCard({ args, result }: AskUserQuestionToolCardProps) {
  const questions = (args.questions as Question[]) || [];
  const answers = parseAnswers(result);
  const rawText = getAnswerText(result);
  const firstHeader = questions[0]?.header || 'Question';
  const answered = result !== undefined;

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
            {answered && questions.length === 1 && answers ? (
              <span className="text-mf-text-primary/70">
                {' — '}
                {formatShortAnswer(questions[0]!.question, answers)}
              </span>
            ) : null}
          </span>
        </>
      }
      trailing={<StatusDot result={result} isError={false} />}
    >
      <div className="px-3 py-2 space-y-3">
        {questions.map((q, i) => (
          <div key={i} className="space-y-1.5">
            <p className="text-mf-small text-mf-text-primary/80">{q.question}</p>
            {answers ? (
              <AnswerDisplay question={q} answer={answers[q.question]} />
            ) : rawText ? (
              <p className="text-mf-small text-mf-text-secondary/60 ml-2">{rawText}</p>
            ) : null}
          </div>
        ))}
      </div>
    </CollapsibleToolCard>
  );
}

function formatShortAnswer(question: string, answers: Record<string, string | string[]>): string {
  const answer = answers[question];
  if (!answer) return '';
  if (Array.isArray(answer)) return answer.join(', ');
  return answer;
}

function AnswerDisplay({ question, answer }: { question: Question; answer: string | string[] | undefined }) {
  if (!answer) return null;
  const selected = Array.isArray(answer) ? answer : [answer];

  return (
    <div className="flex flex-wrap gap-1.5 ml-2">
      {question.options.map((opt) => {
        const isSelected = selected.includes(opt.label);
        return (
          <span
            key={opt.label}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-mf-small',
              isSelected
                ? 'bg-mf-accent/15 text-mf-accent border border-mf-accent/30'
                : 'bg-mf-input-bg/40 text-mf-text-secondary/40 border border-transparent',
            )}
          >
            {isSelected && <Check size={11} className="shrink-0" />}
            {opt.label}
          </span>
        );
      })}
      {selected.some((s) => !question.options.some((o) => o.label === s)) &&
        selected
          .filter((s) => !question.options.some((o) => o.label === s))
          .map((custom) => (
            <span
              key={custom}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-mf-small bg-mf-accent/15 text-mf-accent border border-mf-accent/30"
            >
              <Check size={11} className="shrink-0" />
              {custom}
            </span>
          ))}
    </div>
  );
}
