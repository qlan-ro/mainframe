/**
 * RunInlineForm — the paused Ask-me answer form embedded inline in the run
 * timeline (ts153 wf2-runtime.jsx `WfRunForm`, ported onto the real
 * `AutomationInteractionSummary.fields` and `gateway.respondInteraction`
 * instead of a local unsubmitted mock). TDD: test written first, implemented
 * after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationInteractionSummary } from '../../contract';
import { createFakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsStore } from '../../data/use-automations-store';
import { RunInlineForm } from '../RunInlineForm';

const INTERACTION: AutomationInteractionSummary = {
  id: 'ix-1',
  runId: 'run-1',
  stepRef: 'ask-ado-link',
  title: 'Link an ADO item?',
  fields: [
    {
      key: 'action',
      type: 'choice',
      label: 'Action',
      options: ['link existing', 'create new', 'skip'],
      required: true,
    },
    { key: 'adoId', type: 'text', label: 'ADO item ID', showWhen: { key: 'action', equals: 'link existing' } },
    { key: 'note', type: 'multi', label: 'Tags', options: ['urgent', 'blocked'] },
  ],
  status: 'pending',
  createdAt: 1,
  resolvedAt: null,
};

beforeEach(() => {
  useAutomationsStore.setState({ gateway: createFakeGateway() });
});

describe('RunInlineForm — rendering', () => {
  it('renders the interaction title and every field label', () => {
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);
    expect(screen.getByText('Link an ADO item?')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('renders choice options as pill buttons', () => {
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);
    expect(screen.getByTestId('automations-run-form-ix-1-field-action-option-link existing')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-form-ix-1-field-action-option-create new')).toBeInTheDocument();
  });
});

describe('RunInlineForm — show-when', () => {
  it('hides a showWhen field until its controlling field matches', async () => {
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);
    expect(screen.queryByTestId('automations-run-form-ix-1-field-adoId-input')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-link existing'));
    expect(screen.getByTestId('automations-run-form-ix-1-field-adoId-input')).toBeInTheDocument();
  });

  it('re-hides the field once the controlling value no longer matches', async () => {
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);
    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-link existing'));
    expect(screen.getByTestId('automations-run-form-ix-1-field-adoId-input')).toBeInTheDocument();

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-create new'));
    expect(screen.queryByTestId('automations-run-form-ix-1-field-adoId-input')).not.toBeInTheDocument();
  });
});

describe('RunInlineForm — submit payload', () => {
  it('submits exactly the answered visible fields via gateway.respondInteraction', async () => {
    const respondInteraction = vi.fn().mockResolvedValue(undefined);
    useAutomationsStore.setState({ gateway: createFakeGateway({ respondInteraction }) });
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-skip'));
    await user.click(screen.getByTestId('automations-run-form-ix-1-field-note-option-urgent'));
    await user.click(screen.getByTestId('automations-run-form-ix-1-submit'));

    expect(respondInteraction).toHaveBeenCalledWith('ix-1', { action: 'skip', note: ['urgent'] });
  });

  it('disables Submit until every visible required field has a value', async () => {
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);
    expect(screen.getByTestId('automations-run-form-ix-1-submit')).toBeDisabled();

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-skip'));
    expect(screen.getByTestId('automations-run-form-ix-1-submit')).not.toBeDisabled();
  });

  it('removes the interaction from the store after a successful respond', async () => {
    const respondInteraction = vi.fn().mockResolvedValue(undefined);
    useAutomationsStore.setState({ gateway: createFakeGateway({ respondInteraction }), interactions: [INTERACTION] });
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" />);

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-skip'));
    await user.click(screen.getByTestId('automations-run-form-ix-1-submit'));

    expect(useAutomationsStore.getState().interactions).toEqual([]);
  });

  it('calls onSubmitted after a successful respond', async () => {
    const respondInteraction = vi.fn().mockResolvedValue(undefined);
    useAutomationsStore.setState({ gateway: createFakeGateway({ respondInteraction }) });
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<RunInlineForm interaction={INTERACTION} testId="automations-run-form-ix-1" onSubmitted={onSubmitted} />);

    await user.click(screen.getByTestId('automations-run-form-ix-1-field-action-option-skip'));
    await user.click(screen.getByTestId('automations-run-form-ix-1-submit'));

    expect(onSubmitted).toHaveBeenCalled();
  });
});
