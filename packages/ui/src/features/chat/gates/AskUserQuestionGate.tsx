import { useState, useCallback } from 'react';
import { MessageCircleQuestionIcon } from 'lucide-react';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GateCardShell, GATE_BODY_INSET, GATE_PRIMARY } from './shared/GateShell';
import { buildAskUserQuestionResponse } from './build-control-response';
import { AskQuestionWizard } from './AskQuestionWizard';
import { assembleAnswers, resolveChosen } from './answers';
import type { AskQuestion } from './answers';
import { askerParts, type GateContext, type ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AskUserQuestionGateProps {
  entry: ChatPermissionEntry;
  reply: ReplyFn;
  context?: GateContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toggle(
  prev: Map<number, Set<string>>,
  qIdx: number,
  label: string,
  isMulti: boolean,
): Map<number, Set<string>> {
  const next = new Map(prev);
  const current = new Set(prev.get(qIdx) ?? []);
  if (current.has(label)) {
    current.delete(label);
  } else {
    if (!isMulti) current.clear();
    current.add(label);
  }
  next.set(qIdx, current);
  return next;
}

/** Decide if a single question has at least one resolved answer. */
function isQuestionAnswered(
  qIdx: number,
  selections: ReadonlyMap<number, ReadonlySet<string>>,
  otherText: ReadonlyMap<number, string>,
): boolean {
  return resolveChosen([...(selections.get(qIdx) ?? new Set<string>())], otherText.get(qIdx) ?? '').length > 0;
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

interface FooterProps {
  current: number;
  total: number;
  isAnswered: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

function WizardFooter({ current, total, isAnswered, onSkip, onBack, onNext, onSubmit }: FooterProps) {
  const isLast = current === total - 1;

  return (
    <div className={cn('flex items-center gap-2 pt-1 pr-4 pb-3', GATE_BODY_INSET)}>
      <Button variant="outline" size="sm" data-testid="chat-question-skip" onClick={onSkip}>
        Skip
      </Button>
      {current > 0 && (
        <Button variant="outline" size="sm" data-testid="chat-question-back" onClick={onBack}>
          Back
        </Button>
      )}
      <div className="flex-1" />
      {!isLast && (
        <Button
          size="sm"
          className={GATE_PRIMARY}
          data-testid="chat-question-next"
          disabled={!isAnswered}
          onClick={onNext}
        >
          Next
        </Button>
      )}
      {isLast && (
        <Button
          size="sm"
          className={GATE_PRIMARY}
          data-testid="chat-question-submit"
          disabled={!isAnswered}
          onClick={onSubmit}
        >
          Submit
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskUserQuestionGate
// ---------------------------------------------------------------------------

export function AskUserQuestionGate({ entry, reply, context }: AskUserQuestionGateProps) {
  const questions = (entry.request.input.questions as AskQuestion[] | undefined) ?? [];

  const [current, setCurrent] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherText, setOtherText] = useState<Map<number, string>>(() => new Map());

  const activeQuestion = questions[current];
  const isMulti = Boolean(activeQuestion?.multiSelect);
  const isAnswered = activeQuestion ? isQuestionAnswered(current, selections, otherText) : false;

  const handleToggle = useCallback(
    (label: string) => {
      setSelections((prev) => toggle(prev, current, label, isMulti));
    },
    [current, isMulti],
  );

  const handleOtherText = useCallback(
    (v: string) => {
      setOtherText((prev) => {
        const next = new Map(prev);
        next.set(current, v);
        return next;
      });
    },
    [current],
  );

  const handleSkip = useCallback(() => {
    void reply(buildAskUserQuestionResponse(entry, undefined));
  }, [entry, reply]);

  const handleBack = useCallback(() => {
    setCurrent((c) => c - 1);
  }, []);

  const handleNext = useCallback(() => {
    setCurrent((c) => c + 1);
  }, []);

  const handleSubmit = useCallback(() => {
    const answers = assembleAnswers(questions, selections, otherText);
    void reply(buildAskUserQuestionResponse(entry, answers));
  }, [entry, questions, reply, selections, otherText]);

  const title = activeQuestion?.question ?? '';
  const details = [
    activeQuestion?.header,
    isMulti ? 'select all that apply' : undefined,
    ...askerParts(context, true),
  ].filter(Boolean);

  return (
    <div data-testid="chat-question-gate" role="group" aria-label="Question from the agent">
      <GateCardShell>
        {/* The question is the title; its context sits under it, with no label above (G4). */}
        <div className="flex items-start gap-2.5 px-4 pt-3 pb-2">
          <span
            data-testid="gate-head-tile"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-accent-ink"
          >
            <MessageCircleQuestionIcon className="size-3.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col pt-0.5">
            <h3 data-testid="chat-question-text" className="text-[0.875rem] leading-5 font-semibold text-foreground">
              {title}
            </h3>
            {details.length > 0 && (
              <span data-testid="chat-question-context" className="text-xs text-muted-foreground">
                {details.join(' · ')}
              </span>
            )}
          </div>
          {questions.length > 1 && (
            <Badge variant="outline" className="shrink-0 font-mono tabular-nums">
              {current + 1} of {questions.length}
            </Badge>
          )}
        </div>
        {activeQuestion && (
          <AskQuestionWizard
            question={activeQuestion}
            qIndex={current}
            selected={selections.get(current) ?? new Set<string>()}
            otherText={otherText.get(current) ?? ''}
            onToggle={handleToggle}
            onOtherText={handleOtherText}
          />
        )}
        <WizardFooter
          current={current}
          total={questions.length}
          isAnswered={isAnswered}
          onSkip={handleSkip}
          onBack={handleBack}
          onNext={handleNext}
          onSubmit={handleSubmit}
        />
      </GateCardShell>
    </div>
  );
}
