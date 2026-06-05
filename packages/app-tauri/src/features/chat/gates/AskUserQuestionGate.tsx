import { useState, useCallback } from 'react';
import { MessageCircleQuestionIcon } from 'lucide-react';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead } from './shared/GateShell';
import { GateButton } from './shared/GateButton';
import { buildAskUserQuestionResponse } from './build-control-response';
import { AskQuestionWizard } from './AskQuestionWizard';
import { assembleAnswers, OTHER } from './answers';
import type { AskQuestion } from './answers';
import type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AskUserQuestionGateProps {
  entry: ChatPermissionEntry;
  reply: ReplyFn;
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

/** Mirror assembleAnswers for a single question to decide if it is answered. */
function isQuestionAnswered(
  qIdx: number,
  selections: ReadonlyMap<number, ReadonlySet<string>>,
  otherText: ReadonlyMap<number, string>,
): boolean {
  const chosen = [...(selections.get(qIdx) ?? new Set<string>())]
    .map((label) => (label === OTHER ? (otherText.get(qIdx) ?? '').trim() : label))
    .filter(Boolean);
  return chosen.length > 0;
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
    <div className="flex items-center gap-2 px-3.5 pb-3 pt-1">
      <GateButton kind="ghost" data-testid="chat-question-skip" onClick={onSkip}>
        Skip
      </GateButton>
      {current > 0 && (
        <GateButton kind="ghost" data-testid="chat-question-back" onClick={onBack}>
          Back
        </GateButton>
      )}
      <div className="flex-1" />
      {!isLast && (
        <GateButton kind="primary" data-testid="chat-question-next" disabled={!isAnswered} onClick={onNext}>
          Next
        </GateButton>
      )}
      {isLast && (
        <GateButton kind="primary" data-testid="chat-question-submit" disabled={!isAnswered} onClick={onSubmit}>
          Submit
        </GateButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskUserQuestionGate
// ---------------------------------------------------------------------------

export function AskUserQuestionGate({ entry, reply }: AskUserQuestionGateProps) {
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
    void reply(entry.requestId, buildAskUserQuestionResponse(entry, undefined));
  }, [entry, reply]);

  const handleBack = useCallback(() => {
    setCurrent((c) => c - 1);
  }, []);

  const handleNext = useCallback(() => {
    setCurrent((c) => c + 1);
  }, []);

  const handleSubmit = useCallback(() => {
    const answers = assembleAnswers(questions, selections, otherText);
    void reply(entry.requestId, buildAskUserQuestionResponse(entry, answers));
  }, [entry, questions, reply, selections, otherText]);

  const eyebrow = isMulti ? 'Question · select all that apply' : 'Question';
  const title = activeQuestion?.question ?? '';

  return (
    <div data-testid="chat-question-gate">
      <GateCardShell>
        <GateHead
          icon={<MessageCircleQuestionIcon className="size-4" />}
          tileClassName="bg-mf-selection text-primary"
          eyebrow={eyebrow}
          title={title}
          right={
            questions.length > 1 ? (
              <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-micro font-semibold text-mf-text-3 ring-1 ring-border">
                {current + 1} of {questions.length}
              </span>
            ) : undefined
          }
        />
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
