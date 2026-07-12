/**
 * WhenCard — trigger rows + add menu (ts153 wf2-editor.jsx `WfTriggerAdd` +
 * the "When" band's trigger list). Offers schedule/event/webhook only — the
 * contract's `AutomationTrigger` union has no "manual" variant (manual
 * running is always available regardless of what's in `triggers[]`).
 */
import { useState } from 'react';
import { Calendar, Globe, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AutomationTrigger } from '../contract';
import { TriggerRow } from './TriggerRow';

interface TriggerAddOption {
  kind: AutomationTrigger['kind'];
  icon: LucideIcon;
  label: string;
  hint: string;
}

const TRIGGER_ADD_OPTIONS: TriggerAddOption[] = [
  { kind: 'schedule', icon: Calendar, label: 'On a schedule', hint: 'Runs automatically at set times' },
  { kind: 'event', icon: Zap, label: 'When something happens', hint: 'React to an event' },
  { kind: 'webhook', icon: Globe, label: 'Webhook', hint: 'An auto-generated URL calls it' },
];

function newTrigger(kind: AutomationTrigger['kind']): AutomationTrigger {
  const id = crypto.randomUUID();
  if (kind === 'schedule') return { id, kind, schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' };
  if (kind === 'event') return { id, kind, event: 'session.finished' };
  return { id, kind: 'webhook', hookId: `pending-${id}` };
}

export interface WhenCardProps {
  triggers: AutomationTrigger[];
  onChange: (next: AutomationTrigger[]) => void;
}

export function WhenCard({ triggers, onChange }: WhenCardProps) {
  const [open, setOpen] = useState(false);

  function setAt(index: number, next: AutomationTrigger | null) {
    const arr = triggers.slice();
    if (next === null) arr.splice(index, 1);
    else arr[index] = next;
    onChange(arr);
  }

  function add(kind: AutomationTrigger['kind']) {
    onChange([...triggers, newTrigger(kind)]);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {triggers.map((trigger, i) => (
        <TriggerRow
          key={trigger.id}
          trigger={trigger}
          onChange={(next) => setAt(i, next)}
          testId={`automations-trigger-${trigger.id}`}
        />
      ))}
      {triggers.length === 0 && (
        <div className="text-label text-muted-foreground">No trigger yet — you’ll run it by hand.</div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="automations-when-add"
            className="self-start text-caption font-semibold text-primary"
          >
            + Add a trigger
          </button>
        </PopoverTrigger>
        <PopoverContent data-testid="automations-when-add-menu" align="start" className="w-64 p-1.5">
          {TRIGGER_ADD_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.kind}
                type="button"
                data-testid={`automations-when-add-${option.kind}`}
                onClick={() => add(option.kind)}
                className="flex w-full items-start gap-2.5 rounded-md p-2 text-left hover:bg-accent"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-mf-wf-kind-call/12">
                  <Icon size={12} className="text-mf-wf-kind-call" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-label font-semibold text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}
