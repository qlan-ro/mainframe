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
 * The event picker's menu lists five entries: the three curated
 * `AutomationEventName` values plus two GitHub PR presets. Contract §1: PR
 * opened/merged are webhook presets under the hood (daemon-side match
 * predicate keyed by `hookId`), so picking one replaces the trigger with a
 * `WebhookTrigger` rather than storing an event name the contract doesn't
 * have. No live webhook-registration route exists yet (Phase 6 dependency)
 * — the `hookId` is a client-generated placeholder, matching the
 * always-placeholder URL/sample state webhook rows show regardless of
 * origin.
 */
import { Calendar, Check, Globe, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import type { AutomationEventName, AutomationTrigger } from '../contract';
import { MiniSelect } from '../fields/MiniSelect';
import { SchedulePicker } from './SchedulePicker';

interface EventMenuOption {
  label: string;
  apply: (id: string) => AutomationTrigger;
}

const EVENT_OPTIONS: EventMenuOption[] = [
  { label: 'A chat session finishes', apply: (id) => ({ id, kind: 'event', event: 'session.finished' }) },
  { label: 'Another automation finishes', apply: (id) => ({ id, kind: 'event', event: 'automation.finished' }) },
  { label: 'Another automation fails', apply: (id) => ({ id, kind: 'event', event: 'automation.failed' }) },
  { label: 'A pull request is opened (GitHub)', apply: (id) => ({ id, kind: 'webhook', hookId: `pending-${id}` }) },
  { label: 'A pull request is merged (GitHub)', apply: (id) => ({ id, kind: 'webhook', hookId: `pending-${id}` }) },
];

const EVENT_LABELS: Record<AutomationEventName, string> = {
  'session.finished': 'A chat session finishes',
  'automation.finished': 'Another automation finishes',
  'automation.failed': 'Another automation fails',
};

const TRIGGER_META: Record<AutomationTrigger['kind'], { icon: LucideIcon; label: string }> = {
  schedule: { icon: Calendar, label: 'On a schedule' },
  event: { icon: Zap, label: 'When something happens' },
  webhook: { icon: Globe, label: 'Webhook' },
};

export interface TriggerRowProps {
  trigger: AutomationTrigger;
  onChange: (next: AutomationTrigger | null) => void;
  testId: string;
}

export function TriggerRow({ trigger, onChange, testId }: TriggerRowProps) {
  const meta = TRIGGER_META[trigger.kind];
  const Icon = meta.icon;

  return (
    <div
      data-testid={testId}
      className="flex items-start gap-2.5 rounded-md border-[0.5px] border-border bg-card p-2.5"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-mf-auto-kind-call/12">
        <Icon size={14} className="text-mf-auto-kind-call" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-label font-semibold text-foreground">{meta.label}</div>
        {trigger.kind === 'schedule' && (
          <div className="mt-1.5">
            <SchedulePicker trigger={trigger} onChange={onChange} testId={`${testId}-schedule`} />
          </div>
        )}
        {trigger.kind === 'event' && (
          <div className="mt-1.5">
            <MiniSelect
              value={EVENT_LABELS[trigger.event]}
              options={EVENT_OPTIONS.map((o) => o.label)}
              onChange={(label) => {
                const option = EVENT_OPTIONS.find((o) => o.label === label);
                if (option) onChange(option.apply(trigger.id));
              }}
              testId={`${testId}-event`}
              width={280}
            />
          </div>
        )}
        {trigger.kind === 'webhook' && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 font-mono text-caption text-muted-foreground">
              <Globe size={11} aria-hidden />
              https://hooks.mainframe.app/w/{trigger.hookId}
            </div>
            <div className="flex items-center gap-1 text-caption text-muted-foreground">
              <Check size={11} className="text-mf-success" aria-hidden />
              Signature verified
            </div>
            <div className="text-caption text-muted-foreground">
              No sample captured yet — capture one call to read its fields as tokens.
            </div>
          </div>
        )}
      </div>
      <Hint label="Remove trigger">
        <button
          type="button"
          data-testid={`${testId}-remove`}
          onClick={() => onChange(null)}
          aria-label="Remove trigger"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
