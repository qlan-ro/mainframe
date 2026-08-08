/**
 * TriggerRow — per-kind trigger row (ts153 wf2-editor.jsx `WfTriggerRow`).
 *
 * ts153 also had a `manual` trigger kind you could explicitly add; the
 * contract's `AutomationTrigger` union has no such variant (manual running
 * is an always-available property of the system — `AutomationRunSummary.
 * trigger.kind` includes `'manual'` for RUNS, not for stored triggers) — so
 * this component and `WhenCard`'s add menu only ever handle
 * schedule/event/webhook.
 *
 * The event picker offers the three curated `AutomationEventName` values
 * and nothing else. Contract §1: GitHub PR opened/merged are webhook
 * *presets* (a daemon-side match predicate keyed by `hookId`), not events —
 * offering them here fabricated a webhook trigger out of an event picker.
 *
 * The source filter (`automationId`) narrows which automation to watch. The
 * daemon drops a filtered binding whose event carries no source automation
 * (`triggers/router.rs`: `(Some(_), None) => false`), so a filter on
 * `session.finished` would silently never fire — hence the filter only
 * exists, and only survives an event change, for the two automation events.
 */
import { Calendar, Globe, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AutomationEventName, AutomationTrigger, EventTrigger } from '../contract';
import { useAutomationsStore } from '../data/use-automations-store';
import { SchedulePicker } from './SchedulePicker';
import { WebhookTriggerCard } from './WebhookTriggerCard';

const EVENTS: Array<{ value: AutomationEventName; label: string }> = [
  { value: 'session.finished', label: 'A chat session finishes' },
  { value: 'automation.finished', label: 'Another automation finishes' },
  { value: 'automation.failed', label: 'Another automation fails' },
];

const SOURCE_FILTERABLE: ReadonlySet<AutomationEventName> = new Set<AutomationEventName>([
  'automation.finished',
  'automation.failed',
]);

const ANY_SOURCE = '__any__';

function EventTriggerFields({
  trigger,
  onChange,
  testId,
}: {
  trigger: EventTrigger;
  onChange: (next: EventTrigger) => void;
  testId: string;
}) {
  const definitions = useAutomationsStore((s) => s.definitions);

  function handleEvent(event: AutomationEventName) {
    const next: EventTrigger = { id: trigger.id, kind: 'event', event };
    if (SOURCE_FILTERABLE.has(event) && trigger.automationId) next.automationId = trigger.automationId;
    onChange(next);
  }

  function handleSource(value: string) {
    const next: EventTrigger = { id: trigger.id, kind: 'event', event: trigger.event };
    if (value !== ANY_SOURCE) next.automationId = value;
    onChange(next);
  }

  const sources = definitions.map((definition) => ({ id: definition.id, label: definition.name }));
  // A filter pointing at a deleted automation still filters — saying "Any" there would be a lie.
  if (trigger.automationId && !sources.some((s) => s.id === trigger.automationId)) {
    sources.push({ id: trigger.automationId, label: `Unknown automation (${trigger.automationId})` });
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Select value={trigger.event} onValueChange={(next) => handleEvent(next as AutomationEventName)}>
        <SelectTrigger data-testid={`${testId}-event-name`} className="h-[28px] w-[240px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EVENTS.map((event) => (
            <SelectItem
              key={event.value}
              value={event.value}
              data-testid={`${testId}-event-name-option-${event.value.replace('.', '-')}`}
            >
              {event.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {SOURCE_FILTERABLE.has(trigger.event) && (
        <>
          <span className="text-xs text-muted-foreground">from</span>
          <Select value={trigger.automationId ?? ANY_SOURCE} onValueChange={handleSource}>
            <SelectTrigger data-testid={`${testId}-event-source`} className="h-[28px] w-[190px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_SOURCE} data-testid={`${testId}-event-source-option-any`}>
                Any automation
              </SelectItem>
              {sources.map((source) => (
                <SelectItem
                  key={source.id}
                  value={source.id}
                  data-testid={`${testId}-event-source-option-${source.id}`}
                >
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}

const TRIGGER_META: Record<AutomationTrigger['kind'], { icon: LucideIcon; label: string }> = {
  schedule: { icon: Calendar, label: 'On a schedule' },
  event: { icon: Zap, label: 'When something happens' },
  webhook: { icon: Globe, label: 'Webhook' },
};

export interface TriggerRowProps {
  trigger: AutomationTrigger;
  onChange: (next: AutomationTrigger | null) => void;
  /** The owning automation, absent until it is saved — only the webhook card needs it. */
  automationId?: string;
  testId: string;
}

export function TriggerRow({ trigger, onChange, automationId, testId }: TriggerRowProps) {
  const meta = TRIGGER_META[trigger.kind];
  const Icon = meta.icon;

  return (
    <div
      data-testid={testId}
      className="flex items-start gap-2.5 rounded-md border-[0.5px] border-border bg-card p-2.5"
    >
      <span className="flex size-[28px] shrink-0 items-center justify-center rounded-sm bg-mf-auto-kind-call/12">
        <Icon size={14} className="text-mf-auto-kind-call" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-foreground">{meta.label}</div>
        {trigger.kind === 'schedule' && (
          <div className="mt-1.5">
            <SchedulePicker trigger={trigger} onChange={onChange} testId={`${testId}-schedule`} />
          </div>
        )}
        {trigger.kind === 'event' && <EventTriggerFields trigger={trigger} onChange={onChange} testId={testId} />}
        {trigger.kind === 'webhook' && (
          <WebhookTriggerCard trigger={trigger} onChange={onChange} automationId={automationId} testId={testId} />
        )}
      </div>
      <Hint label="Remove trigger">
        <button
          type="button"
          data-testid={`${testId}-remove`}
          onClick={() => onChange(null)}
          aria-label="Remove trigger"
          className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
