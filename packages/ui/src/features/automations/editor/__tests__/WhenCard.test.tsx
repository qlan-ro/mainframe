/**
 * WhenCard — trigger rows + add menu (ts153 wf2-editor.jsx `WfTriggerAdd` +
 * the "When" band's trigger list). Add menu offers schedule/event/webhook
 * only — no "manual" entry (contract's `AutomationTrigger` union has none;
 * manual running is always available regardless). TDD: test written first,
 * implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationTrigger } from '../../contract';
import { WhenCard } from '../WhenCard';

describe('WhenCard — empty state', () => {
  it('shows a hint when there are no triggers yet', () => {
    render(<WhenCard triggers={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/run it by hand/)).toBeInTheDocument();
  });
});

describe('WhenCard — existing triggers', () => {
  it('renders one TriggerRow per trigger, keyed by trigger id', () => {
    const triggers: AutomationTrigger[] = [
      { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' },
      { id: 't2', kind: 'webhook', hookId: 'abc' },
    ];
    render(<WhenCard triggers={triggers} onChange={vi.fn()} />);
    expect(screen.getByTestId('automations-trigger-t1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-trigger-t2')).toBeInTheDocument();
  });

  it('removing a trigger calls onChange without it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const triggers: AutomationTrigger[] = [{ id: 't1', kind: 'webhook', hookId: 'abc' }];
    render(<WhenCard triggers={triggers} onChange={onChange} />);
    await user.click(screen.getByTestId('automations-trigger-t1-remove'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('WhenCard — add menu', () => {
  it('offers exactly schedule/event/webhook — no manual entry', async () => {
    const user = userEvent.setup();
    render(<WhenCard triggers={[]} onChange={vi.fn()} />);
    await user.click(screen.getByTestId('automations-when-add'));
    expect(screen.getByTestId('automations-when-add-schedule')).toBeInTheDocument();
    expect(screen.getByTestId('automations-when-add-event')).toBeInTheDocument();
    expect(screen.getByTestId('automations-when-add-webhook')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-when-add-manual')).not.toBeInTheDocument();
  });

  it('picking "On a schedule" appends a ScheduleTrigger', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WhenCard triggers={[]} onChange={onChange} />);
    await user.click(screen.getByTestId('automations-when-add'));
    await user.click(screen.getByTestId('automations-when-add-schedule'));
    const arr = onChange.mock.calls[0]?.[0] as AutomationTrigger[];
    const added = arr[0];
    expect(added).toMatchObject({ kind: 'schedule', onMissed: 'skip' });
    expect(typeof added?.id).toBe('string');
  });

  it('picking "Webhook" appends a WebhookTrigger with a hookId', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WhenCard triggers={[]} onChange={onChange} />);
    await user.click(screen.getByTestId('automations-when-add'));
    await user.click(screen.getByTestId('automations-when-add-webhook'));
    const arr = onChange.mock.calls[0]?.[0] as AutomationTrigger[];
    expect(arr[0]?.kind).toBe('webhook');
  });
});
