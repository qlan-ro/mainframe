import React, { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import type { PermissionRequest } from '@mainframe/types';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskUserQuestionCardProps {
  request: PermissionRequest;
  onRespond: (behavior: 'allow' | 'deny', alwaysAllow?: string[], overrideInput?: Record<string, unknown>) => void;
}

export function AskUserQuestionCard({ request, onRespond }: AskUserQuestionCardProps): React.ReactElement {
  const questions: Question[] = (request.input.questions as Question[]) || [];
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());

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

  const hasAnySelection = [...selections.values()].some((s) => s.size > 0);
  const cardTitle = questions[0]?.header || 'Question';

  return (
    <div className="border border-mf-accent/30 bg-mf-app-bg rounded-mf-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-mf-accent/10">
        <span className="text-mf-body font-semibold text-mf-text-primary">{cardTitle}</span>
      </div>

      <div className="px-4 py-3 space-y-4">
        {questions.map((q, qIdx) => {
          const selected = selections.get(qIdx) || new Set<string>();
          return (
            <div key={qIdx} className="space-y-2">
              <p className="text-mf-body text-mf-text-primary">{q.question}</p>
              {q.multiSelect ? (
                <div className="flex flex-col gap-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => toggleOption(qIdx, opt.label, true)}
                      className="flex items-center gap-2 text-left group"
                      title={opt.description}
                    >
                      <span
                        className={cn(
                          'shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                          selected.has(opt.label)
                            ? 'border-mf-accent bg-mf-accent'
                            : 'border-mf-divider bg-transparent group-hover:border-mf-text-secondary',
                        )}
                      >
                        {selected.has(opt.label) && <Check size={14} className="text-white" />}
                      </span>
                      <span className="text-mf-body text-mf-text-primary">{opt.label}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => toggleOption(qIdx, '__other__', true)}
                    className="flex items-center gap-2 text-left group"
                  >
                    <span
                      className={cn(
                        'shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                        selected.has('__other__')
                          ? 'border-mf-accent bg-mf-accent'
                          : 'border-mf-divider bg-transparent group-hover:border-mf-text-secondary',
                      )}
                    >
                      {selected.has('__other__') && <Check size={14} className="text-white" />}
                    </span>
                    <span className="text-mf-body text-mf-text-primary">Other</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => toggleOption(qIdx, opt.label, false)}
                      className={cn(
                        'px-3 py-1.5 rounded-mf-card text-mf-body border transition-colors',
                        selected.has(opt.label)
                          ? 'border-mf-accent bg-mf-accent/10 text-mf-text-primary'
                          : 'border-mf-divider bg-transparent text-mf-text-secondary hover:border-mf-text-secondary hover:bg-mf-hover/30',
                      )}
                      title={opt.description}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => toggleOption(qIdx, '__other__', false)}
                    className={cn(
                      'px-3 py-1.5 rounded-mf-card text-mf-body border transition-colors',
                      selected.has('__other__')
                        ? 'border-mf-accent bg-mf-accent/10 text-mf-text-primary'
                        : 'border-mf-divider bg-transparent text-mf-text-secondary hover:border-mf-text-secondary hover:bg-mf-hover/30',
                    )}
                  >
                    Other
                  </button>
                </div>
              )}
              {selected.has('__other__') && (
                <input
                  type="text"
                  autoFocus
                  placeholder="Type your answer..."
                  value={otherTexts.get(qIdx) || ''}
                  onChange={(e) => setOtherText(qIdx, e.target.value)}
                  className="w-full bg-transparent rounded-mf-input px-3 py-2 text-mf-body text-mf-text-primary border border-mf-border placeholder:text-mf-text-secondary focus:outline-none focus:border-mf-accent/50"
                />
              )}
            </div>
          );
        })}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onRespond('deny')}>
            Skip
          </Button>
          <Button
            size="sm"
            className="bg-mf-accent text-white hover:bg-mf-accent/90"
            disabled={!hasAnySelection}
            onClick={handleSubmit}
          >
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}
