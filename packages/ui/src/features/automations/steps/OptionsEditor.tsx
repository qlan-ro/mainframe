/**
 * OptionsEditor — an editable list of option-value chips (ts153's inline
 * options editor in `WfFieldRow`/`WfAskMeConfig`), shared by
 * `ExpectResultsBuilder` (A2 choice results) and `FormFieldRow`
 * (ask_me choice/multi fields) — the same "type a value, ⏎ or , commits it"
 * chip list in both places.
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export interface OptionsEditorProps {
  options: string[];
  onChange: (next: string[]) => void;
  testId: string;
}

export function OptionsEditor({ options, onChange, testId }: OptionsEditorProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    if (!draft.trim()) return;
    onChange([...options, draft.trim()]);
    setDraft('');
  }

  return (
    <div data-testid={testId} className="flex flex-wrap items-center gap-1.5">
      {options.map((option, i) => (
        <span
          key={i}
          className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-caption text-foreground"
        >
          {option}
          <button
            type="button"
            data-testid={`${testId}-remove-${i}`}
            onClick={() => onChange(options.filter((_, k) => k !== i))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={9} aria-hidden />
          </button>
        </span>
      ))}
      <input
        data-testid={`${testId}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={options.length ? 'Add…' : 'Type an option, ⏎'}
        className="min-w-[90px] flex-1 border-none bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
