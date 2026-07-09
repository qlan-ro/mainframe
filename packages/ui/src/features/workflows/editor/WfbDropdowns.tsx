/**
 * WfbDropdowns — Add-trigger dropdown picker for the builder.
 *
 * Extracted from WfBuilderPane to keep file sizes under 300 lines.
 * The trigger picker follows: a trigger button opens a popover with options;
 * clicking an option calls the onAdd callback and closes.
 *
 * Note: WfbAddStep was removed — the builder uses the WfStepLibrary overlay
 * (data-testid="workflows-builder-add-step" lives in WfBuilderPane) which avoids
 * a duplicate testid collision.
 */
import { useState } from 'react';
import { Calendar, Play, BoltIcon } from 'lucide-react';
import type { WfTrigger } from './wf-draft-types';

// ── Trigger kind metadata ─────────────────────────────────────────────────────

const TRIGGER_KINDS: Array<{
  kind: WfTrigger['kind'];
  label: string;
  Icon: typeof Play;
}> = [
  { kind: 'manual', label: 'Manual', Icon: Play },
  { kind: 'schedule', label: 'Schedule', Icon: Calendar },
  { kind: 'event', label: 'Event', Icon: BoltIcon },
];

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
