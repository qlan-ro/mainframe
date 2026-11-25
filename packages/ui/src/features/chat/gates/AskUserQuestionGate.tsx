import { useState, useCallback } from 'react';
import { QuestionIcon } from '@/components/ui/glyphs';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GateCardShell, GATE_BODY_INSET, GATE_BUTTON, GATE_OUTLINE, GATE_PRIMARY } from './shared/GateShell';
import { buildAskUserQuestionResponse } from './build-control-response';
import { AskQuestionWizard } from './AskQuestionWizard';
import { assembleAnswers, resolveChosen } from './answers';
import type { AskQuestion } from './answers';
import { askerParts, type GateContext, type ReplyFn } from './gate-types';
import { visibleLine, visibleText } from './visible-text';

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
    <div className={cn('flex items-center gap-2 pr-4 pb-3.5', GATE_BODY_INSET)}>
      <Button
        variant="outline"
        size="sm"
        className={cn(GATE_BUTTON, GATE_OUTLINE)}
        data-testid="chat-question-skip"
        onClick={onSkip}
      >
        Skip
      </Button>
      {current > 0 && (
        <Button
          variant="outline"
          size="sm"
          className={cn(GATE_BUTTON, GATE_OUTLINE)}
          data-testid="chat-question-back"
          onClick={onBack}
        >
          Back
        </Button>
      )}
      <div className="flex-1" />
      {!isLast && (
        <Button
          size="sm"
          className={cn(GATE_BUTTON, GATE_PRIMARY)}
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
          className={cn(GATE_BUTTON, GATE_PRIMARY)}
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

  // The agent's words: nothing in them hides. Reading order is the language's own, kept apart from the rest.
  const title = visibleText(activeQuestion?.question ?? '');
  const header = activeQuestion?.header && visibleLine(activeQuestion.header);
  const details = [header, isMulti ? 'select all that apply' : undefined].filter(Boolean).join(' · ');
  const asker = visibleLine(askerParts(context, true).join(' · '));

  return (
    <div data-testid="chat-question-gate" role="group" aria-label="Question from the agent">
      <GateCardShell>
        {/* The question is the title; its context sits under it, with no label above (G4). */}
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
          <span
            data-testid="gate-head-tile"
            className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary/12 text-accent-ink"
          >
            <QuestionIcon className="size-3.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 data-testid="chat-question-text" className="text-title font-semibold text-foreground">
              <bdi>{title}</bdi>
            </h3>
            {(details || asker) && (
              <span data-testid="chat-question-context" className="mt-0.5 text-meta/[1.45] text-muted-foreground">
                {details && <bdi>{details}</bdi>}
                {details && asker && ' · '}
                {asker && (
                  <span dir="ltr" className="stored-order">
                    {asker}
                  </span>
                )}
              </span>
            )}
          </div>
          {questions.length > 1 && (
            <Badge
              variant="outline"
              className="h-auto shrink-0 rounded-sm border-input px-1.5 py-px font-mono text-caption/[normal] font-medium text-ink-secondary tabular-nums"
            >
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
