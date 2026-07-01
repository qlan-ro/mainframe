/**
 * WfbDropdowns — Add-trigger and Add-step dropdown pickers for the builder.
 *
 * Extracted from WfBuilderPane to keep file sizes under 300 lines.
 * Both pickers follow the same pattern: a trigger button opens a popover
 * with options; clicking an option calls the onAdd callback and closes.
 */
import { useState } from 'react';
import { Calendar, Play, Globe, BoltIcon } from 'lucide-react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getKindMeta } from '../glyphs';
import type { WfTrigger, WfStep } from './yaml-serialize';

// ── Trigger kind metadata ─────────────────────────────────────────────────────

const TRIGGER_KINDS: Array<{
  kind: WfTrigger['kind'];
  label: string;
  Icon: typeof Play;
}> = [
  { kind: 'manual', label: 'Manual', Icon: Play },
  { kind: 'schedule', label: 'Schedule', Icon: Calendar },
  { kind: 'event', label: 'Event', Icon: BoltIcon },
  { kind: 'webhook', label: 'Webhook', Icon: Globe },
];

// ── Step kinds available in the simple picker ─────────────────────────────────

const STEP_KINDS: WfStep['kind'][] = ['agent', 'service', 'question', 'branch', 'loop', 'parallel', 'subflow', 'set'];

// ── WfbAddTrigger ─────────────────────────────────────────────────────────────

interface WfbAddTriggerProps {
  onAdd: (kind: WfTrigger['kind']) => void;
}

export function WfbAddTrigger({ onAdd }: WfbAddTriggerProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="workflows-builder-add-trigger"
        onClick={() => setOpen((o) => !o)}
        className="text-caption font-semibold text-primary hover:underline"
      >
        + Add trigger
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-[31] w-[168px] rounded-lg border border-border bg-popover p-[5px] shadow-[var(--mf-shadow-pop)]">
            {TRIGGER_KINDS.map(({ kind, label, Icon: KindIcon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAdd(kind);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-[9px] rounded-sm px-2 py-[7px] text-left text-label text-foreground hover:bg-accent"
              >
                <KindIcon size={13} className="text-muted-foreground" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── WfbAddStep ────────────────────────────────────────────────────────────────

interface WfbAddStepProps {
  onAdd: (kind: WfStep['kind']) => void;
}

export function WfbAddStep({ onAdd }: WfbAddStepProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mt-[3px]">
      <button
        type="button"
        data-testid="workflows-builder-add-step"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-7 items-center gap-[6px] rounded-md border border-dashed border-mf-border-hover px-[11px]',
          'text-caption font-semibold text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Plus size={12} aria-hidden />
        Add step
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-[31] w-[200px] rounded-lg border border-border bg-popover p-[5px] shadow-[var(--mf-shadow-pop)]">
            {STEP_KINDS.map((kind) => {
              const meta = getKindMeta(kind);
              const Icon = meta.Icon;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    onAdd(kind);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-[9px] rounded-sm px-2 py-[7px] text-left text-label text-foreground hover:bg-accent"
                >
                  <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm bg-muted">
                    <Icon size={12} className={meta.colorClass} aria-hidden />
                  </span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
