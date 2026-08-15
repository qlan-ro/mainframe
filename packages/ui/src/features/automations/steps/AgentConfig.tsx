/**
 * AgentConfig — the Agent step's composer-shaped card (todo #234 T16): the
 * prompt sits flush in the card with a chip toolbar beneath it (model,
 * permission, worktree) and an advanced disclosure for the fields nobody
 * touches twice. The chips and the advanced panel live in `steps/agent/`.
 *
 * No Send button: a step is configured, never sent. The card borrows the
 * composer's shape so the two surfaces read alike, not its submit path.
 *
 * `MoreOptions` no longer wraps this config — it survives for the
 * AskMe/Notify ones.
 */
import { useState } from 'react';
import type { AskAgentStep } from '../contract';
import { textToChipText } from '../domain/chip-text-convert';
import type { TokenDescriptor } from '../domain/tokens';
import { TriggerTextField } from '../fields/TriggerTextField';
import { singlePart } from './action-fields';
import { AdvancedSection, AdvancedToggle } from './agent/AdvancedSection';
import { ModelMenu } from './agent/ModelMenu';
import { PermissionMenu } from './agent/PermissionMenu';
import { WorktreeMenu } from './agent/WorktreeMenu';

export interface AgentConfigProps {
  step: AskAgentStep;
  onChange: (next: AskAgentStep) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

export function AgentConfig({ step, onChange, tokens, testId }: AgentConfigProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patch = (next: Partial<AskAgentStep>) => onChange({ ...step, ...next });

  return (
    <div
      data-testid={`${testId}-pane`}
      className="rounded-xl [border-width:0.5px] border-border bg-card shadow-sm transition-colors focus-within:border-ring"
    >
      <TriggerTextField
        value={singlePart(step.prompt)}
        onChange={(prompt) => patch({ prompt: textToChipText(prompt) })}
        scope={tokens}
        adapterId={step.adapterId}
        placeholder="What should the agent do?"
        minHeight={56}
        bare
        testId={`${testId}-prompt`}
      />

      <div
        data-testid={`${testId}-toolbar`}
        className="flex items-center justify-between gap-2 px-2.5 pt-[4px] pb-[6px]"
      >
        <div className="flex min-w-0 items-center gap-1">
          <ModelMenu adapterId={step.adapterId} model={step.model} onChange={patch} testId={testId} />
          <PermissionMenu adapterId={step.adapterId} value={step.permissionMode} onChange={patch} testId={testId} />
          <WorktreeMenu worktree={step.worktree} onChange={patch} tokens={tokens} testId={testId} />
        </div>
        <AdvancedToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)} testId={testId} />
      </div>

      {advancedOpen && <AdvancedSection step={step} onChange={patch} testId={testId} />}
    </div>
  );
}
