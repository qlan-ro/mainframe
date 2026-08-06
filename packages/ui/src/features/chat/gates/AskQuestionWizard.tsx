/**
 * The option list for one AskUserQuestion question.
 *
 * The row chrome is the shadcn `questionnaire` kit's `QuestionnaireChoice`
 * recipe — min-h-11, hairline `border-input`, `border-primary/40 bg-muted` when
 * chosen, a size-4 indicator — but NOT its primitive. See the ledger for why:
 * the kit's state model is a `<form>` whose only value surface is FormData, and
 * its Skip is per-question while this gate's Skip answers the whole request once.
 */
import { Input } from '@v2/components/ui/input';
import { Checkbox } from '@v2/components/ui/checkbox';
import { cn } from '@v2/lib/utils';
import { OTHER } from './answers';
import type { AskQuestion } from './answers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AskQuestionWizardProps {
  question: AskQuestion;
  qIndex: number;
  selected: ReadonlySet<string>;
  otherText: string;
  onToggle: (label: string) => void;
  onOtherText: (v: string) => void;
}

// ---------------------------------------------------------------------------
// Option row
// ---------------------------------------------------------------------------

interface OptionRowProps {
  label: string;
  description?: string;
  isSelected: boolean;
  isMulti: boolean;
  testId: string;
  onToggle: () => void;
}

function OptionRow({ label, description, isSelected, isMulti, testId, onToggle }: OptionRowProps) {
  // A `<div role="button">` (not a native <button>) so the multi-select branch can
  // nest the real interactive Checkbox primitive without invalid nested-button HTML.
  return (
    <div
      data-testid={testId}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm shadow-xs transition-colors select-none',
        isSelected ? 'border-primary/40 bg-muted' : 'border-input bg-transparent hover:bg-muted/50 dark:bg-input/20',
      )}
    >
      {isMulti ? (
        <Checkbox className="pointer-events-none mt-0.5" checked={isSelected} tabIndex={-1} aria-hidden="true" />
      ) : (
        // Radio indicator, the kit's shape: a filled dot inside a ring.
        <span
          data-radio-indicator
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            isSelected ? 'border-primary bg-primary' : 'border-input',
          )}
        >
          {isSelected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskQuestionWizard
// ---------------------------------------------------------------------------

export function AskQuestionWizard({
  question,
  qIndex,
  selected,
  otherText,
  onToggle,
  onOtherText,
}: AskQuestionWizardProps) {
  const isMulti = Boolean(question.multiSelect);
  const otherSelected = selected.has(OTHER);

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      {question.options.map((opt) => (
        <OptionRow
          key={opt.label}
          label={opt.label}
          description={opt.description}
          isSelected={selected.has(opt.label)}
          isMulti={isMulti}
          testId={`chat-question-option-${qIndex}-${opt.label}`}
          onToggle={() => onToggle(opt.label)}
        />
      ))}
      <OptionRow
        label="Other…"
        description="Write your own answer"
        isSelected={otherSelected}
        isMulti={isMulti}
        testId={`chat-question-option-${qIndex}-${OTHER}`}
        onToggle={() => onToggle(OTHER)}
      />
      {otherSelected && (
        <Input
          data-testid={`chat-question-other-input-${qIndex}`}
          placeholder="Type your answer…"
          value={otherText}
          onChange={(e) => onOtherText(e.target.value)}
          className="mt-1 animate-in duration-150 fade-in-0 slide-in-from-top-1"
          autoFocus
        />
      )}
    </div>
  );
}
