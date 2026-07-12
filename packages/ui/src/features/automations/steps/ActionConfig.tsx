/**
 * ActionConfig — picked-action header + Change; embeds `ActionCatalog` when
 * unpicked (ts153 wf2-stepconfig.jsx `WfActionConfig`, ported onto the
 * contract's `RunActionStep` — `actionId`/`credential`/`params`/`outputAs`
 * are all top-level fields, never nested under an `args` bag like ts153's
 * `step.args`). Composes `AutoForm` (params), `CredentialConnect` (only
 * when `action.auth === 'token'`, using the real `credentialLabelHint` —
 * not a UI-invented field), the `run_command`-only outputAs segment +
 * `CommandPreview` (A1), and `FailureToggle` under `MoreOptions`.
 *
 * Picking (fresh or via "Change") always replaces the step with a bare
 * `{id, kind, actionId, params: {}}` — a deliberate improvement over ts153,
 * which kept `args` across a re-pick even though the new action's field
 * keys don't match the old one's.
 */
import { useState } from 'react';
import { Plug } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, RunActionStep } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { ActionCatalog } from './ActionCatalog';
import { asActionParamsSchema } from './action-fields';
import { AutoForm } from './AutoForm';
import { CommandPreview } from './CommandPreview';
import { CredentialConnect } from './CredentialConnect';
import { FailureToggle } from './FailureToggle';
import { MoreOptions } from './MoreOptions';

export interface ActionConfigProps {
  step: RunActionStep;
  onChange: (next: RunActionStep) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  testId: string;
}

const OUTPUT_AS_OPTIONS: Array<{ id: NonNullable<RunActionStep['outputAs']>; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'lines', label: 'Lines' },
];

export function ActionConfig({ step, onChange, tokens, catalog, testId }: ActionConfigProps) {
  const action = catalog.find((a) => a.id === step.actionId);
  const [picking, setPicking] = useState(false);

  function pick(next: ActionCatalogEntry) {
    onChange({ id: step.id, kind: 'run_action', actionId: next.id, params: {} });
    setPicking(false);
  }

  if (!action || picking) {
    return (
      <div className="rounded-md border-[0.5px] border-border p-2">
        <ActionCatalog catalog={catalog} onPick={pick} testId={`${testId}-catalog`} />
      </div>
    );
  }

  const schema = asActionParamsSchema(action.paramsSchema);
  const isRunCommand = action.id === 'run_command';

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid={`${testId}-header`}
        className="flex items-center gap-2.5 rounded-md border-[0.5px] border-mf-auto-violet/20 bg-mf-auto-violet/[0.07] px-2.5 py-1.5"
      >
        <Plug size={14} className="text-mf-auto-violet" aria-hidden />
        <span className="flex-1 text-body font-semibold text-foreground">{action.title}</span>
        <button
          type="button"
          data-testid={`${testId}-change`}
          onClick={() => setPicking(true)}
          className="h-6 rounded-md border-[0.5px] border-border bg-card px-2.5 text-caption font-semibold text-muted-foreground hover:bg-accent"
        >
          Change
        </button>
      </div>

      <AutoForm
        schema={schema}
        params={step.params}
        onChange={(params) => onChange({ ...step, params })}
        tokens={tokens}
        testId={`${testId}-form`}
      />

      {action.auth === 'token' && (
        <CredentialConnect
          service={action.credentialLabelHint ?? action.title}
          onChange={(credential) => onChange({ ...step, credential })}
          testId={`${testId}-credential`}
        />
      )}

      {isRunCommand && schema.hasOutputAs && (
        <div className="flex items-center gap-2.5">
          <span className="text-caption font-medium text-muted-foreground">Treat output as</span>
          <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
            {OUTPUT_AS_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`${testId}-outputas-${option.id}`}
                onClick={() => onChange({ ...step, outputAs: option.id })}
                className={cn(
                  'rounded-sm px-2.5 py-1 text-label font-medium',
                  (step.outputAs ?? 'text') === option.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isRunCommand && <CommandPreview script={step.params.script ?? []} testId={`${testId}-preview`} />}

      <MoreOptions testId={`${testId}-more`}>
        <FailureToggle
          keepGoing={!!step.keepGoing}
          onChange={(keepGoing) => onChange({ ...step, keepGoing })}
          testId={`${testId}-keepgoing`}
        />
      </MoreOptions>
    </div>
  );
}
