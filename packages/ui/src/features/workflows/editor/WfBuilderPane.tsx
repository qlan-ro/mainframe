/**
 * WfBuilderPane — visual builder for new workflows.
 *
 * Sections: Identity, Triggers, Inputs, Steps, Outputs. Every mutation
 * calls onChange(nextModel); the caller calls serializeWorkflow() to keep
 * the YAML pane live. Builder is for new workflows only (edit mode is
 * YAML-only until YAML→model reparse is implemented in a future task).
 * Ported from WfBuilderPane in 19-wfeditor.jsx; tokens → Tailwind v4.
 */
import { Zap, SlidersHorizontal, Layers, CircleDot, X, Play, Calendar, BoltIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { stubTrigger } from './wf-stubs';
import { WfbAddTrigger } from './WfbDropdowns';
import { WfStepList } from './WfStepList';
import { WfbOutputRow } from './WfbOutputRow';
import type { WfDraft, WfTrigger } from './wf-draft-types';

// ── WfbSection ────────────────────────────────────────────────────────────────

interface WfbSectionProps {
  Icon: typeof Layers;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function WfbSection({ Icon, title, count, action, children }: WfbSectionProps): React.ReactElement {
  return (
    <div className="mb-[16px]">
      <div className="mb-[8px] flex items-center gap-[8px]">
        <Icon size={13} className="text-mf-text-3" aria-hidden />
        <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{title}</span>
        {count != null && <span className="font-mono text-micro text-mf-text-3">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Trigger row ───────────────────────────────────────────────────────────────

const TRIGGER_ICON_MAP: Record<string, typeof Play> = {
  manual: Play,
  schedule: Calendar,
  event: BoltIcon,
};

const TRIGGER_LABEL_MAP: Record<string, string> = {
  manual: 'Manual',
  schedule: 'Schedule',
  event: 'Event',
};

interface TriggerRowProps {
  trigger: WfTrigger;
  onRemove: () => void;
}

function triggerDetail(trigger: WfTrigger): string {
  switch (trigger.kind) {
    case 'schedule':
      return trigger.label ?? trigger.cron;
    case 'event':
      return trigger.on;
    case 'manual':
      return 'started by hand';
  }
}

function TriggerRow({ trigger, onRemove }: TriggerRowProps): React.ReactElement {
  const TriggerIcon = TRIGGER_ICON_MAP[trigger.kind] ?? Play;
  const label = TRIGGER_LABEL_MAP[trigger.kind] ?? trigger.kind;
  const detail = triggerDetail(trigger);

  return (
    <div className="flex items-center gap-[9px] rounded-md border border-border bg-card px-[10px] py-[8px]">
      <span className="inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm bg-muted">
        <TriggerIcon size={12} className="text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-label font-semibold text-foreground">{label}</div>
        <div className="font-mono text-micro text-mf-text-3">{detail}</div>
      </div>
      <Hint label="Remove trigger">
        <button
          type="button"
          aria-label="Remove trigger"
          onClick={onRemove}
          className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}

// ── WfBuilderPane ─────────────────────────────────────────────────────────────

export interface WfBuilderPaneProps {
  model: WfDraft;
  onChange: (next: WfDraft) => void;
}

export function WfBuilderPane({ model, onChange }: WfBuilderPaneProps): React.ReactElement {
  function patch(partial: Partial<WfDraft>): void {
    onChange({ ...model, ...partial });
  }

  function addTrigger(kind: WfTrigger['kind']): void {
    patch({ triggers: [...model.triggers, stubTrigger(kind)] });
  }

  function removeTrigger(i: number): void {
    patch({ triggers: model.triggers.filter((_, k) => k !== i) });
  }

  function addOutput(): void {
    const newOutput = { name: `output${model.outputs.length + 1}`, expr: '${ ... }' };
    patch({ outputs: [...model.outputs, newOutput] });
  }

  function removeOutput(i: number): void {
    patch({ outputs: model.outputs.filter((_, k) => k !== i) });
  }

  function setOutputField(i: number, partial: { name?: string; expr?: string }): void {
    const outputs = [...model.outputs];
    outputs[i] = { ...outputs[i]!, ...partial };
    patch({ outputs });
  }

  function addInput(): void {
    const newInput = { name: `input${model.inputs.length + 1}`, type: 'string' };
    patch({ inputs: [...model.inputs, newInput] });
  }

  return (
    <div
      data-testid="workflows-builder"
      className="h-full min-h-0 overflow-y-auto bg-card px-[18px] pb-[28px] pt-[16px]"
    >
      <div className="max-w-[560px]">
        {/* ── Identity ── */}
        <div className="mb-[18px] flex flex-col gap-[10px]">
          <input
            data-testid="workflows-builder-name"
            type="text"
            value={model.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Workflow name"
            className="border-none bg-transparent p-0 font-sans text-display font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
          />
          <input
            data-testid="workflows-builder-description"
            type="text"
            value={model.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="What does this automation do?"
            className="border-none bg-transparent p-0 text-label text-muted-foreground outline-none placeholder:text-mf-text-3"
          />
          <div className="inline-flex self-start gap-0.5 rounded-md bg-muted p-0.5">
            {(
              [
                ['global', 'Global'],
                ['project', 'This project'],
              ] as const
            ).map(([id, label]) => {
              const active = model.scope === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`workflows-builder-scope-${id}`}
                  onClick={() => patch({ scope: id })}
                  className={cn(
                    'rounded-sm px-[12px] py-[5px] text-label font-medium',
                    active ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-mf-text-3 hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Triggers ── */}
        <WfbSection
          Icon={Zap}
          title="Triggers"
          count={model.triggers.length}
          action={<WfbAddTrigger onAdd={addTrigger} />}
        >
          <div className="flex flex-col gap-[6px]">
            {model.triggers.map((t, i) => (
              <TriggerRow key={i} trigger={t} onRemove={() => removeTrigger(i)} />
            ))}
            {model.triggers.length === 0 && (
              <p className="px-0.5 py-1 text-caption text-mf-text-3">No triggers — manual start only.</p>
            )}
          </div>
        </WfbSection>

        {/* ── Inputs ── */}
        <WfbSection
          Icon={SlidersHorizontal}
          title="Inputs"
          count={model.inputs.length}
          action={
            <button
              type="button"
              onClick={addInput}
              className="text-caption font-semibold text-primary hover:underline"
            >
              + Add input
            </button>
          }
        >
          {model.inputs.length > 0 ? (
            <div className="flex flex-col gap-1">
              {model.inputs.map((inp, i) => (
                <div key={i} className="flex items-center gap-[8px] py-[6px] font-mono text-caption">
                  <span className="font-semibold text-foreground">{inp.name}</span>
                  <span className="inline-flex h-[17px] items-center rounded-[3px] bg-muted px-[7px] font-semibold text-muted-foreground">
                    {inp.type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-0.5 py-1 text-caption text-mf-text-3">No declared inputs.</p>
          )}
        </WfbSection>

        {/* ── Steps ── */}
        <WfbSection Icon={Layers} title="Steps" count={model.steps.length}>
          <WfStepList draft={model} path={[]} onRootChange={(steps) => patch({ steps })} />
        </WfbSection>

        {/* ── Outputs ── */}
        <WfbSection
          Icon={CircleDot}
          title="Outputs"
          count={model.outputs.length}
          action={
            <button
              type="button"
              data-testid="workflows-builder-add-output"
              onClick={addOutput}
              className="text-caption font-semibold text-primary hover:underline"
            >
              + Add output
            </button>
          }
        >
          {model.outputs.length > 0 ? (
            <div className="flex flex-col gap-[6px]">
              {model.outputs.map((o, i) => (
                <WfbOutputRow
                  key={i}
                  output={o}
                  onChange={(partial) => setOutputField(i, partial)}
                  onRemove={() => removeOutput(i)}
                />
              ))}
            </div>
          ) : (
            <p className="px-0.5 py-1 text-caption text-mf-text-3">
              No declared outputs — nothing is returned to a parent workflow.
            </p>
          )}
        </WfbSection>
      </div>
    </div>
  );
}
