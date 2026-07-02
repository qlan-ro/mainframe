import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
        'flex w-full items-start gap-[11px] rounded-md border px-[11px] py-[9px] text-left transition-colors cursor-pointer',
        isSelected ? 'border-primary bg-mf-selection' : 'border-border hover:border-mf-border-hover hover:bg-accent',
      )}
    >
      {isMulti ? (
        // Shared pixel-accurate Checkbox primitive (17x17, rounded-[5px], real checkmark icon).
        <Checkbox
          className="mt-0.5 pointer-events-none"
          checked={isSelected}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : (
        // Radio indicator: thick border when selected (no fill), hairline when not.
        <span
          data-radio-indicator
          className={cn(
            'mt-0.5 size-4 shrink-0 rounded-full transition-all',
            isSelected ? 'border-[5px] border-primary' : 'border border-mf-text-4',
          )}
        />
      )}
      <span className="min-w-0">
        <span className="block text-body font-semibold text-foreground">{label}</span>
        {description && <span className="block text-caption text-mf-text-3">{description}</span>}
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
    <div className="flex flex-col gap-2 px-3.5 pb-3">
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
          className="mt-1 animate-in fade-in-0 slide-in-from-top-1 duration-150 bg-transparent"
          autoFocus
        />
      )}
    </div>
  );
}
