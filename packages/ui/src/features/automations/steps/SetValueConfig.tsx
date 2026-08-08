/**
 * SetValueConfig — the `set_variable` step's pane: the name later steps type
 * as `$name`, and the value it stands for.
 *
 * The name is a draft until blur or Enter. Committing it rewrites every
 * downstream `$oldname` (`editor/definition-actions.ts`), so a per-keystroke
 * commit would rewrite the automation once per letter and rename half-typed
 * names into existence. A name that could never be typed back as `$name` is
 * refused at the commit, in `validate`'s own words — the value would otherwise
 * be unreachable until the footer explained why. The pane only knows the names
 * in scope *above* it, so a clash with a later step or the sibling `if` arm
 * passes this check and is reported by `validate` on the card and in the
 * footer instead; every name this check refuses, `validate` refuses too.
 *
 * No `MoreOptions`/`FailureToggle` here (unlike the other four panes): naming
 * a value runs no external work, so `keepGoing` has nothing to keep going
 * past. The `$name` echo under the input is the pane's whole point — a step
 * whose only output is an identifier has to show the identifier.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { variableNamesInScope } from '@qlan-ro/mainframe-types';
import { Input } from '@/components/ui/input';
import type { SetVariableStep } from '../contract';
import { textToChipText } from '../domain/chip-text-convert';
import type { TokenDescriptor } from '../domain/tokens';
import { setVariableNameIssue } from '../domain/validate';
import { TriggerTextField } from '../fields/TriggerTextField';
import { singlePart } from './action-fields';

export interface SetValueConfigProps {
  step: SetVariableStep;
  onChange: (next: SetVariableStep) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

function NameStatus({ error, name, testId }: { error: string | null; name: string; testId: string }) {
  if (error) {
    return (
      <span data-testid={`${testId}-name-error`} className="text-xs font-medium text-destructive">
        {error}
      </span>
    );
  }
  return (
    <span data-testid={`${testId}-reference`} className="text-xs text-muted-foreground">
      {name ? (
        <>
          Later steps use <span className="font-mono text-foreground">${name}</span>.
        </>
      ) : (
        'Name it to use it in later steps.'
      )}
    </span>
  );
}

interface NameFieldProps {
  name: string;
  onCommit: (name: string) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

function NameField({ name, onCommit, tokens, testId }: NameFieldProps) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === name) {
      setError(null);
      return;
    }
    const issue = setVariableNameIssue(trimmed, variableNamesInScope(tokens));
    setError(issue);
    if (!issue) onCommit(trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commit();
  }

  return (
    <>
      <Input
        data-testid={`${testId}-name`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder="release_notes"
        className="h-[26px] px-2 py-0 font-mono text-xs"
      />
      <NameStatus error={error} name={name} testId={testId} />
    </>
  );
}

export function SetValueConfig({ step, onChange, tokens, testId }: SetValueConfigProps) {
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-xs font-medium text-muted-foreground">Name</span>
      <NameField name={step.name} onCommit={(name) => onChange({ ...step, name })} tokens={tokens} testId={testId} />
      <span className="text-xs font-medium text-muted-foreground">Value</span>
      <TriggerTextField
        value={singlePart(step.value)}
        onChange={(value) => onChange({ ...step, value: textToChipText(value) })}
        scope={tokens}
        placeholder="What should this name stand for?"
        minHeight={48}
        testId={`${testId}-value`}
      />
    </div>
  );
}
