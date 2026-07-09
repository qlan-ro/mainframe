/**
 * WfbStepRow — a single step row in the visual builder.
 *
 * Shows: drag handle (decorative), kind icon chip, inline-editable title,
 * summary text, Configure (expand) toggle, and a remove button. The
 * Configure panel mounts `WfStepConfigForm` for the step's own fields;
 * nested composite child rendering (choose arms, foreach body, parallel
 * branches) is added on top by `WfStepList`, which wraps this component.
 */
import { useEffect, useRef, useState } from 'react';
import { GripVertical, SlidersHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { getKindMeta } from '../glyphs';
import { WfStepConfigForm } from './config/WfStepConfigForm';
import { WfStepList } from './WfStepList';
import type { WfScopeSource, WfStepPath } from './config/wf-scope';
import type { WfDraft, WfStep } from './wf-draft-types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface WfbStepRowProps {
  step: WfStep;
  index: number;
  onPatch?: (patch: Partial<WfStep>) => void;
  onRemove: () => void;
  scope?: WfScopeSource[];
  /** Recursion hooks (Task 14) — only used to nest a `WfStepList` for composite kinds. */
  draft?: WfDraft;
  path?: WfStepPath;
  onRootChange?: (steps: WfStep[]) => void;
}

// ── Summary helper ────────────────────────────────────────────────────────────

function stepSummary(step: WfStep): string {
  switch (step.kind) {
    case 'form':
      return `${step.form.fields.length} fields${step.form.timeout ? ` · ${step.form.timeout.afterMinutes}m timeout` : ''}`;
    case 'service':
      return step.connector;
    case 'agent':
      return 'agent session';
    case 'parallel':
      return `${Object.keys(step.branches).length} branches`;
    case 'choose':
      return `${step.arms.length} arms`;
    case 'foreach':
      return `for each ${step.over}`;
    case 'call':
      return step.ref;
    default:
      return 'value';
  }
}

// ── Nested composite children (choose arms / foreach body / parallel branches) ──

interface WfbNestedCompositeProps {
  step: WfStep;
  draft?: WfDraft;
  path?: WfStepPath;
  onRootChange?: (steps: WfStep[]) => void;
}

function WfbNestedComposite({ step, draft, path, onRootChange }: WfbNestedCompositeProps): React.ReactElement | null {
  if (!draft || !path || !onRootChange) return null;

  if (step.kind === 'choose') {
    return (
      <div className="mt-[8px] flex flex-col gap-[10px] border-t border-border pt-[10px]">
        {step.arms.map((arm, k) => (
          <div key={k} className="pl-[14px]">
            <div className="mb-[6px] text-micro font-bold uppercase tracking-wide text-mf-text-3">
              {arm.else ? 'Else' : `Arm ${k}`}
            </div>
            <WfStepList draft={draft} path={[...path, { arm: k }]} onRootChange={onRootChange} />
          </div>
        ))}
      </div>
    );
  }

  if (step.kind === 'foreach') {
    return (
      <div className="mt-[8px] border-t border-border pt-[10px] pl-[14px]">
        <WfStepList draft={draft} path={path} onRootChange={onRootChange} />
      </div>
    );
  }

  if (step.kind === 'parallel') {
    return (
      <div className="mt-[8px] flex flex-col gap-[10px] border-t border-border pt-[10px]">
        {Object.keys(step.branches).map((name) => (
          <div key={name} className="pl-[14px]">
            <div className="mb-[6px] text-micro font-bold uppercase tracking-wide text-mf-text-3">{name}</div>
            <WfStepList draft={draft} path={[...path, { branch: name }]} onRootChange={onRootChange} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WfbStepRow({
  step,
  index,
  onPatch,
  onRemove,
  scope = [],
  draft,
  path,
  onRootChange,
}: WfbStepRowProps): React.ReactElement {
  const meta = getKindMeta(step.kind);
  const Icon = meta.Icon;
  const summary = stepSummary(step);
  const title = step.name ?? meta.label;
  const [configOpen, setConfigOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (configOpen) panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [configOpen]);

  return (
    <div
      data-testid={`workflows-builder-step-${step.id ?? String(index)}`}
      className="mb-[7px] overflow-hidden rounded-md border border-border bg-card"
    >
      {/* Main row */}
      <div className="flex items-center gap-[9px] px-[10px] py-[8px]">
        {/* Drag handle (decorative) */}
        <GripVertical size={14} className="shrink-0 cursor-grab text-mf-text-4" aria-hidden />

        {/* Kind icon chip */}
        <span className={cn('inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm bg-muted')}>
          <Icon size={13} className={meta.colorClass} aria-hidden />
        </span>

        {/* Inline-editable title — prototype line 341 */}
        <input
          data-testid={`workflows-builder-step-title-${step.id ?? String(index)}`}
          type="text"
          value={title}
          onChange={(e) => onPatch?.({ name: e.target.value })}
          className="min-w-0 flex-1 border-none bg-transparent p-0 text-body font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />

        {/* Summary */}
        <span className="shrink-0 font-mono text-micro text-mf-text-3">{summary}</span>

        {/* Configure expand toggle — prototype line 345-347 */}
        <Hint label="Configure step">
          <button
            type="button"
            aria-label="Configure step"
            aria-expanded={configOpen}
            data-testid={`workflows-builder-step-configure-${step.id ?? String(index)}`}
            onClick={() => setConfigOpen((o) => !o)}
            className={cn(
              'inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm',
              configOpen ? 'bg-muted text-foreground' : 'text-mf-text-3 hover:bg-accent hover:text-foreground',
            )}
          >
            <SlidersHorizontal size={13} aria-hidden />
          </button>
        </Hint>

        {/* Remove */}
        <Hint label="Remove step">
          <button
            type="button"
            aria-label="Remove step"
            data-testid={`workflows-builder-step-remove-${step.id ?? String(index)}`}
            onClick={onRemove}
            className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </Hint>
      </div>

      {/* Configure panel */}
      {configOpen && (
        <div ref={panelRef} className="border-t border-border pt-[2px] pr-[12px] pb-[12px] pl-[30px]">
          <WfStepConfigForm step={step} onPatch={onPatch ?? (() => {})} scope={scope} />
          <WfbNestedComposite step={step} draft={draft} path={path} onRootChange={onRootChange} />
        </div>
      )}
    </div>
  );
}
