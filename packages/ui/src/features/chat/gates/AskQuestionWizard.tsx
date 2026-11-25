/**
 * The option list for one AskUserQuestion question.
 *
 * The row chrome is the shadcn `questionnaire` kit's `QuestionnaireChoice`
 * recipe — hairline `border-input`, `border-input bg-queue-well` when chosen, a
 * size-4 indicator — in compact rows aligned to the question's text (G4), but
 * NOT its primitive. See the ledger for why:
 * the kit's state model is a `<form>` whose only value surface is FormData, and
 * its Skip is per-question while this gate's Skip answers the whole request once.
 */
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { GATE_BODY_INSET } from './shared/GateShell';
import { visibleLine, visibleText } from './visible-text';
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

/** The suffix a model marks its preferred option with; it shows as a tag. */
const RECOMMENDED = /\s*\(Recommended\)$/i;

interface OptionRowProps {
  label: string;
  description?: string;
  isSelected: boolean;
  isMulti: boolean;
  testId: string;
  onToggle: () => void;
}

function OptionRow({ label, description, isSelected, isMulti, testId, onToggle }: OptionRowProps) {
  const recommended = RECOMMENDED.test(label);
  // A `<div>` with a role (not a native <button>) so the multi-select branch can
  // nest the real interactive Checkbox primitive without invalid nested-button HTML.
  return (
    <div
      data-testid={testId}
      role={isMulti ? 'checkbox' : 'radio'}
      tabIndex={0}
      aria-checked={isSelected}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-left text-transcript/[1.45] transition-colors select-none focus-visible:focus-line-inset',
        isSelected
          ? 'border-primary/45 bg-queue-well hover:bg-sidebar-accent'
          : 'border-input bg-transparent hover:bg-sidebar-accent',
      )}
    >
      {isMulti ? (
        <Checkbox
          className="pointer-events-none mt-0.5 border-muted-foreground"
          checked={isSelected}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : (
        // Radio indicator, the kit's shape: a filled dot inside a ring.
        <span
          data-radio-indicator
          className={cn(
            'mt-0.5 size-4 shrink-0 rounded-full transition-colors',
            isSelected ? 'border-[5px] border-accent-fill' : 'border border-muted-foreground',
          )}
        />
      )}
      <span className="min-w-0">
        <span className="block text-row/[20.55px] font-medium text-foreground">
          {visibleLine(label.replace(RECOMMENDED, ''))}
          {recommended && (
            <span data-testid={`${testId}-recommended`} className="ml-1.5 text-xs text-accent-ink">
              Recommended
            </span>
          )}
        </span>
        {description && (
          <span className="mt-px block text-meta/[1.45] text-muted-foreground">{visibleText(description)}</span>
        )}
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
    <div
      role={isMulti ? 'group' : 'radiogroup'}
      aria-label={visibleText(question.question ?? '')}
      className={cn('flex flex-col gap-1.5 pr-4 pb-3', GATE_BODY_INSET)}
    >
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
          className="h-8 rounded-md border-input bg-card px-2.5 text-row shadow-none animate-in duration-150 fade-in-0 slide-in-from-top-1"
          autoFocus
        />
      )}
    </div>
  );
}
