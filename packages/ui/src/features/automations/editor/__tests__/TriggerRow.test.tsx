/**
 * TriggerRow — per-kind trigger row (ts153 wf2-editor.jsx `WfTriggerRow`).
 *
 * The event branch is the contract's curated `AutomationEventName` set only
 * (session.finished / automation.finished / automation.failed). GitHub PR
 * opened/merged are webhook *presets*, not events, so they are not offered
 * here. `automation.finished`/`automation.failed` additionally carry an
 * optional source filter (`automationId`) naming which automation to watch.
 * TDD: test written first, implemented after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationSummary, AutomationTrigger } from '../../contract';
import { useAutomationsStore } from '../../data/use-automations-store';
import { TriggerRow } from '../TriggerRow';

function automation(id: string, name: string): AutomationSummary {
  return {
    id,
    name,
    scope: 'project',
    projectId: 'proj-1',
    enabled: true,
    definition: { triggers: [], steps: [] },
    createdAt: 1,
    updatedAt: 1,
  };
}

/** The shared select is a portalled popover — its options only exist once the trigger is open. */
async function openOptions(user: ReturnType<typeof userEvent.setup>, testId: string): Promise<Array<string | null>> {
  await user.click(screen.getByTestId(testId));
  return screen.getAllByRole('option').map((o) => o.textContent);
}

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
  beforeEach(() => {
    useAutomationsStore.setState({
      definitions: [automation('auto-1', 'Nightly digest'), automation('auto-2', 'Triage')],
    });
  });

  afterEach(() => {
    useAutomationsStore.setState({ definitions: [] });
  });

  it('offers the three curated events and nothing else', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(await openOptions(user, 'trig-event-name')).toEqual([
      'A chat session finishes',
      'Another automation finishes',
      'Another automation fails',
    ]);
  });

  it('no longer offers the GitHub PR presets as events', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    const labels = await openOptions(user, 'trig-event-name');
    expect(labels.some((label) => label?.includes('pull request'))).toBe(false);
  });

  it('picking a curated event calls onChange with an EventTrigger', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-event-name'));
    await user.click(screen.getByTestId('trig-event-name-option-automation-failed'));
    expect(onChange).toHaveBeenCalledWith({ id: 't1', kind: 'event', event: 'automation.failed' });
  });

  it('offers no source filter for a session event, which the daemon would never match', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'session.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.queryByTestId('trig-event-source')).not.toBeInTheDocument();
  });

  it('lists every automation plus an Any option as the source filter', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'automation.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(await openOptions(user, 'trig-event-source')).toEqual(['Any automation', 'Nightly digest', 'Triage']);
  });

  it('defaults the source filter to Any when the trigger has no automationId', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'automation.finished' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByTestId('trig-event-source')).toHaveTextContent('Any automation');
  });

  it('round-trips an existing automationId into the source filter', () => {
    const trigger: AutomationTrigger = {
      id: 't1',
      kind: 'event',
      event: 'automation.finished',
      automationId: 'auto-2',
    };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByTestId('trig-event-source')).toHaveTextContent('Triage');
  });

  it('picking a source automation patches automationId', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = { id: 't1', kind: 'event', event: 'automation.finished' };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-event-source'));
    await user.click(screen.getByTestId('trig-event-source-option-auto-1'));
    expect(onChange).toHaveBeenCalledWith({
      id: 't1',
      kind: 'event',
      event: 'automation.finished',
      automationId: 'auto-1',
    });
  });

  it('picking Any clears automationId', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = {
      id: 't1',
      kind: 'event',
      event: 'automation.finished',
      automationId: 'auto-1',
    };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-event-source'));
    await user.click(screen.getByTestId('trig-event-source-option-any'));
    expect(onChange).toHaveBeenCalledWith({ id: 't1', kind: 'event', event: 'automation.finished' });
  });

  it('drops a source filter the new event cannot use, so the trigger stays live', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = {
      id: 't1',
      kind: 'event',
      event: 'automation.finished',
      automationId: 'auto-1',
    };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-event-name'));
    await user.click(screen.getByTestId('trig-event-name-option-session-finished'));
    expect(onChange).toHaveBeenCalledWith({ id: 't1', kind: 'event', event: 'session.finished' });
  });

  it('keeps a usable source filter when switching between automation events', async () => {
    const user = userEvent.setup();
    const trigger: AutomationTrigger = {
      id: 't1',
      kind: 'event',
      event: 'automation.finished',
      automationId: 'auto-1',
    };
    const onChange = vi.fn();
    render(<TriggerRow trigger={trigger} onChange={onChange} testId="trig" />);
    await user.click(screen.getByTestId('trig-event-name'));
    await user.click(screen.getByTestId('trig-event-name-option-automation-failed'));
    expect(onChange).toHaveBeenCalledWith({
      id: 't1',
      kind: 'event',
      event: 'automation.failed',
      automationId: 'auto-1',
    });
  });
});

describe('TriggerRow — webhook', () => {
  it('renders its WebhookTriggerCard', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'webhook', hookId: 'abc123' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook')).toBeInTheDocument();
  });

  it('passes the automation id down, so an unsaved automation cannot register', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'webhook', hookId: 'abc123' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByTestId('trig-webhook-register')).toBeDisabled();
  });

  it('invents no URL of its own', () => {
    const trigger: AutomationTrigger = { id: 't1', kind: 'webhook', hookId: 'abc123' };
    render(<TriggerRow trigger={trigger} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
    expect(screen.queryByText(/No sample captured yet/)).not.toBeInTheDocument();
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
