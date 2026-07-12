/**
 * TriggerChips — icon + human summary pill per trigger, shared by
 * `LibraryRow` (an automation's own trigger row) and `describe/DraftPreview`
 * (the drafted automation hasn't been saved yet, but its "When" section
 * should look identical to what the library row will render once it is).
 *
 * All trigger kinds share one hue (`WF2_SRC.trigger` in the ts153 palette,
 * `--mf-auto-kind-call` here) — the icon shape, not the color, is what tells
 * schedule/event/webhook apart. Per the 2026-07-11 typography audit's ink
 * policy, the hue lives on the icon + tint background only; the label text
 * stays `muted-foreground`.
 */
import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calendar, Globe, Zap } from 'lucide-react';
import { summarizeTrigger } from '../domain/trigger-summary';
import type { AutomationTrigger } from '../contract';

const TRIGGER_ICON: Record<AutomationTrigger['kind'], LucideIcon> = {
  schedule: Calendar,
  event: Zap,
  webhook: Globe,
};

export function TriggerChips({ triggers }: { triggers: AutomationTrigger[] }): ReactElement | null {
  if (triggers.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-[7px]">
      {triggers.map((trigger) => {
        const Icon = TRIGGER_ICON[trigger.kind];
        return (
          <span
            key={trigger.id}
            className="inline-flex h-[20px] items-center gap-[5px] rounded-full bg-mf-auto-kind-call/12 px-[8px] text-caption font-medium text-muted-foreground"
          >
            <Icon size={12} className="text-mf-auto-kind-call" aria-hidden />
            {summarizeTrigger(trigger)}
          </span>
        );
      })}
    </span>
  );
}
