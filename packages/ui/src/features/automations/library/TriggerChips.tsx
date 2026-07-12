/**
 * TriggerChips — icon + human summary pill per trigger, shared by
 * `LibraryRow` (an automation's own trigger row) and `describe/DraftPreview`
 * (the drafted automation hasn't been saved yet, but its "When" section
 * should look identical to what the library row will render once it is).
 */
import React from 'react';
import { Calendar, Globe, Zap } from 'lucide-react';
import { summarizeTrigger } from '../domain/trigger-summary';
import type { AutomationTrigger } from '../contract';

const TRIGGER_ICON: Record<
  AutomationTrigger['kind'],
  React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
> = {
  schedule: Calendar,
  event: Zap,
  webhook: Globe,
};

export function TriggerChips({ triggers }: { triggers: AutomationTrigger[] }): React.ReactElement | null {
  if (triggers.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {triggers.map((trigger) => {
        const Icon = TRIGGER_ICON[trigger.kind];
        return (
          <span
            key={trigger.id}
            className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground"
          >
            <Icon size={11} aria-hidden />
            {summarizeTrigger(trigger)}
          </span>
        );
      })}
    </span>
  );
}
