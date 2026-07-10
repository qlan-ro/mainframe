/**
 * WfBuilderPane — visual builder for new workflows.
 *
 * Sections: Identity, Triggers, Inputs, Steps, Outputs. Every mutation
 * calls onChange(nextModel); the caller calls serializeWorkflow() to keep
 * the YAML pane live. Builder is for new workflows only (edit mode is
 * YAML-only until YAML→model reparse is implemented in a future task).
 * Ported from WfBuilderPane in 19-wfeditor.jsx; tokens → Tailwind v4.
 */
import { Zap, SlidersHorizontal, Layers, CircleDot, Braces } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stubTrigger } from './wf-stubs';
import { WfbAddTrigger } from './WfbDropdowns';
import { WfStepList } from './WfStepList';
import { WfbOutputRow } from './WfbOutputRow';
import { WfbVarRow } from './WfbVarRow';
import { WfbTriggerRow } from './WfbTriggerRow';
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

// ── WfBuilderPane ─────────────────────────────────────────────────────────────

export interface WfBuilderPaneProps {
  model: WfDraft;
  onChange: (next: WfDraft) => void;
  /** Validate/save errors keyed by step id (Task 21) — threaded down to WfStepList. */
  errors?: Record<string, string>;
}

export function WfBuilderPane({ model, onChange, errors }: WfBuilderPaneProps): React.ReactElement {
  function patch(partial: Partial<WfDraft>): void {
    onChange({ ...model, ...partial });
  }

  function addVar(): void {
    const existing = new Set(model.vars.map((v) => v.key));
    let n = 1;
    while (existing.has(`var${n}`)) n++;
    patch({ vars: [...model.vars, { key: `var${n}`, value: '' }] });
  }

  function removeVar(i: number): void {
    patch({ vars: model.vars.filter((_, k) => k !== i) });
  }

  function setVarField(i: number, partial: Partial<WfDraft['vars'][number]>): void {
    const vars = [...model.vars];
    vars[i] = { ...vars[i]!, ...partial };
    patch({ vars });
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
              <WfbTriggerRow key={i} trigger={t} onRemove={() => removeTrigger(i)} />
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
              data-testid="workflows-builder-add-input"
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

        {/* ── Vars ── */}
        <WfbSection
          Icon={Braces}
          title="Vars"
          count={model.vars.length}
          action={
            <button
              type="button"
              data-testid="workflows-builder-add-var"
              onClick={addVar}
              className="text-caption font-semibold text-primary hover:underline"
            >
              + Add var
            </button>
          }
        >
          {model.vars.length > 0 ? (
            <div className="flex flex-col gap-[6px]">
              {model.vars.map((v, i) => (
                <WfbVarRow
                  key={i}
                  wfVar={v}
                  onChange={(partial) => setVarField(i, partial)}
                  onRemove={() => removeVar(i)}
                />
              ))}
            </div>
          ) : (
            <p className="px-0.5 py-1 text-caption text-mf-text-3">No declared vars.</p>
          )}
        </WfbSection>

        {/* ── Steps ── */}
        <WfbSection Icon={Layers} title="Steps" count={model.steps.length}>
          <WfStepList draft={model} path={[]} onRootChange={(steps) => patch({ steps })} errors={errors} />
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
