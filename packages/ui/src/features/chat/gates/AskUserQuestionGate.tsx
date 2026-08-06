import { useState, useCallback } from 'react';
import { MessageCircleQuestionIcon } from 'lucide-react';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { Button } from '@v2/components/ui/button';
import { Badge } from '@v2/components/ui/badge';
import { cn } from '@v2/lib/utils';
import { GateCardShell, GateHead, GATE_BODY_INSET } from './shared/GateShell';
import { buildAskUserQuestionResponse } from './build-control-response';
import { AskQuestionWizard } from './AskQuestionWizard';
import { assembleAnswers, resolveChosen } from './answers';
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
    <div className="flex items-center gap-2 px-4 pt-1 pb-3">
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
        <Button size="sm" data-testid="chat-question-next" disabled={!isAnswered} onClick={onNext}>
          Next
        </Button>
      )}
      {isLast && (
        <Button size="sm" data-testid="chat-question-submit" disabled={!isAnswered} onClick={onSubmit}>
          Submit
        </Button>
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

  const eyebrow = isMulti ? 'Question · select all that apply' : 'Question';
  // Title with the model's short `header` label when present (e.g. "Auth method"),
  // mirroring desktop; the question text then drops to a body line so it isn't lost.
  // Without a header, the question text stays the title (current behavior).
  const headerTitle = activeQuestion?.header ?? questions[0]?.header;
  const title = headerTitle ?? activeQuestion?.question ?? '';
  const questionBody = headerTitle ? activeQuestion?.question : undefined;

  return (
    <div data-testid="chat-question-gate">
      <GateCardShell>
        <GateHead
          icon={<MessageCircleQuestionIcon className="size-3.5" />}
          tileClassName="bg-primary/10 text-primary"
          eyebrow={eyebrow}
          title={title}
          right={
            questions.length > 1 ? (
              <Badge variant="outline" className="shrink-0 font-mono tabular-nums">
                {current + 1} of {questions.length}
              </Badge>
            ) : undefined
          }
        />
        {questionBody && (
          <p data-testid="chat-question-text" className={cn('pr-4 pb-1 text-sm text-foreground', GATE_BODY_INSET)}>
            {questionBody}
          </p>
        )}
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
