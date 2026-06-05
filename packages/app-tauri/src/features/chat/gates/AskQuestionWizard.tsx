import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
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
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        isSelected ? 'border-primary bg-mf-selection' : 'border-border hover:border-mf-border-hover hover:bg-accent',
      )}
    >
      {isMulti ? (
        // Checkbox indicator: filled square when selected, outlined when not.
        <span
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
            isSelected ? 'border-primary bg-primary' : 'border-mf-text-4 bg-transparent',
          )}
        >
          {isSelected && <span className="size-2 rounded-sm bg-primary-foreground" />}
        </span>
      ) : (
        // Radio indicator: thick border when selected (no fill), hairline when not.
        <span
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
    </button>
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
          className="mt-1 bg-transparent"
          autoFocus
        />
      )}
    </div>
  );
}
