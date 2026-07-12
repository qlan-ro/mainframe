/**
 * TriggerRow — per-kind trigger row (ts153 wf2-editor.jsx `WfTriggerRow`).
 * Webhook rows show the generated URL, a signature note, and a sample
 * placeholder (CHUNK NOTES). The event picker's menu also lists the two
 * GitHub PR presets (contract: curated `AutomationEventName` is
 * session.finished/automation.finished/automation.failed ONLY — GitHub PR
 * opened/merged are webhook presets under the hood), so picking one
 * transforms the trigger's `kind` from `event` to `webhook` entirely rather
 * than storing an event value the contract doesn't have. TDD: test written
 * first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationTrigger } from '../../contract';
import { TriggerRow } from '../TriggerRow';

describe('TriggerRow — schedule', () => {
  it('renders its SchedulePicker', () => {
    const trigger: AutomationTrigger = {
      id: 't1',
      kind: 'schedule',
      schedule: { type: 'daily', at: '09:00' },
      onMissed: 'skip',
    };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByTestId('trig-schedule-preset')).toBeInTheDocument();
  });
});

describe('TriggerRow — event', () => {
  it('lists the three curated events plus the two GitHub PR presets', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    const options = Array.from(screen.getByTestId('trig-event').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual([
      'A chat session finishes',
      'Another automation finishes',
      'Another automation fails',
      'A pull request is opened (GitHub)',
      'A pull request is merged (GitHub)',
    ]);
  });

  it('picking a curated event calls onChange with an EventTrigger', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    fireEvent.change(screen.getByTestId('trig-event'), { target: { value: 'Another automation fails' } });
    expect(onChange).toHaveBeenCalledWith({ id: 't1', kind: 'event', event: 'automation.failed' });
  });

  it('picking a GitHub PR preset transforms the trigger into a WebhookTrigger', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    fireEvent.change(screen.getByTestId('trig-event'), { target: { value: 'A pull request is opened (GitHub)' } });
    const arg = onChange.mock.calls[0]?.[0] as { id: string; kind: string; hookId?: string };
    expect(arg).toMatchObject({ id: 't1', kind: 'webhook' });
    expect(typeof arg.hookId).toBe('string');
  });
});

describe('TriggerRow — webhook', () => {
  it('shows the generated URL, a signature note, and a sample placeholder', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'webhook', hookId: 'abc123' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.getByText('Signature verified')).toBeInTheDocument();
    expect(screen.getByText(/No sample captured yet/)).toBeInTheDocument();
  });
});

describe('TriggerRow — remove', () => {
  it('clicking remove calls onChange(null)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const trigger: AutomationTrigger = { id: 't1', kind: 'webhook', hookId: 'abc123' };
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-remove'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
