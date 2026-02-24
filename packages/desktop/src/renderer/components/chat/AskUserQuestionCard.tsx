import React, { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import type { ControlRequest, ControlUpdate } from '@mainframe/types';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskUserQuestionCardProps {
  request: ControlRequest;
  onRespond: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: ControlUpdate[],
    overrideInput?: Record<string, unknown>,
  ) => void;
}

export function AskUserQuestionCard({ request, onRespond }: AskUserQuestionCardProps): React.ReactElement {
  const questions: Question[] = (request.input.questions as Question[]) || [];
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const toggleOption = useCallback((qIdx: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(prev.get(qIdx) || []);

      if (label === '__other__') {
        if (current.has(label)) {
          current.delete(label);
        } else {
          if (!multi) current.clear();
          current.add(label);
        }
      } else if (current.has(label)) {
        current.delete(label);
      } else {
        if (!multi) current.clear();
        current.add(label);
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts((prev) => {
      const next = new Map(prev);
      next.set(qIdx, text);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const answers: Record<string, string | string[]> = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      const selected = selections.get(i) || new Set();
      const labels = [...selected].map((s) => (s === '__other__' ? otherTexts.get(i) || '' : s)).filter(Boolean);
      answers[q.question] = q.multiSelect ? labels : labels[0] || '';
    }
    onRespond('allow', undefined, { ...request.input, answers });
  }, [questions, selections, otherTexts, onRespond, request.input]);

  const activeQuestion = questions[currentQuestionIndex];
  const activeSelection = selections.get(currentQuestionIndex) || new Set<string>();
  const hasActiveSelection = activeSelection.size > 0;
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const cardTitle = activeQuestion?.header || questions[0]?.header || 'Question';

  return (
    <div
      data-testid="ask-question-card"
      className="border border-mf-accent/30 bg-mf-app-bg rounded-mf-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-mf-accent/10">
        <span className="text-mf-body font-semibold text-mf-text-primary">{cardTitle}</span>
        {questions.length > 1 && (
          <span className="text-mf-small text-mf-text-secondary">
            Question {currentQuestionIndex + 1} of {questions.length}
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-4">
        {activeQuestion ? (
          <div className="space-y-2">
            <p className="text-mf-body text-mf-text-primary">{activeQuestion.question}</p>
            <div className="flex flex-col gap-2">
              {activeQuestion.options.map((opt) => (
                <button
                  key={opt.label}
                  role={activeQuestion.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={activeSelection.has(opt.label)}
                  onClick={() => toggleOption(currentQuestionIndex, opt.label, Boolean(activeQuestion.multiSelect))}
                  className={cn(
                    'w-full flex items-start gap-3 text-left group rounded-mf-card border px-3 py-2 transition-colors',
                    activeSelection.has(opt.label)
                      ? 'border-mf-accent bg-mf-accent/10'
                      : 'border-mf-divider bg-transparent hover:border-mf-text-secondary hover:bg-mf-hover/30',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                      activeQuestion.multiSelect ? 'rounded' : 'rounded-full',
                      activeSelection.has(opt.label)
                        ? 'border-mf-accent bg-mf-accent'
                        : 'border-mf-divider bg-transparent group-hover:border-mf-text-secondary',
                    )}
                  >
                    {activeSelection.has(opt.label) && <Check size={14} className="text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-mf-body text-mf-text-primary">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-mf-small text-mf-text-secondary">{opt.description}</span>
                    )}
                  </span>
                </button>
              ))}
              <button
                role={activeQuestion.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={activeSelection.has('__other__')}
                onClick={() => toggleOption(currentQuestionIndex, '__other__', Boolean(activeQuestion.multiSelect))}
                className={cn(
                  'w-full flex items-start gap-3 text-left group rounded-mf-card border px-3 py-2 transition-colors',
                  activeSelection.has('__other__')
                    ? 'border-mf-accent bg-mf-accent/10'
                    : 'border-mf-divider bg-transparent hover:border-mf-text-secondary hover:bg-mf-hover/30',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                    activeQuestion.multiSelect ? 'rounded' : 'rounded-full',
                    activeSelection.has('__other__')
                      ? 'border-mf-accent bg-mf-accent'
                      : 'border-mf-divider bg-transparent group-hover:border-mf-text-secondary',
                  )}
                >
                  {activeSelection.has('__other__') && <Check size={14} className="text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-mf-body text-mf-text-primary">Other</span>
                  <span className="block text-mf-small text-mf-text-secondary">Provide a custom answer.</span>
                </span>
              </button>
            </div>
            {activeSelection.has('__other__') && (
              <input
                type="text"
                autoFocus
                placeholder="Type your answer..."
                value={otherTexts.get(currentQuestionIndex) || ''}
                onChange={(e) => setOtherText(currentQuestionIndex, e.target.value)}
                className="w-full bg-transparent rounded-mf-input px-3 py-2 text-mf-body text-mf-text-primary border border-mf-border placeholder:text-mf-text-secondary focus:outline-none focus:border-mf-accent/50"
              />
            )}
          </div>
        ) : (
          <p className="text-mf-body text-mf-text-secondary">No questions available.</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <div>
            {currentQuestionIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setCurrentQuestionIndex((idx) => idx - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onRespond('deny')}>
              Skip
            </Button>
            {isLastQuestion ? (
              <Button
                size="sm"
                className="bg-mf-accent text-white hover:bg-mf-accent/90"
                disabled={!hasActiveSelection}
                onClick={handleSubmit}
              >
                Submit
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-mf-accent text-white hover:bg-mf-accent/90"
                disabled={!hasActiveSelection}
                onClick={() => setCurrentQuestionIndex((idx) => idx + 1)}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
