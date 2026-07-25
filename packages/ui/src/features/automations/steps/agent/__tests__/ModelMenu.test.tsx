/**
 * ModelMenu — the Agent card's model chip (todo #234 T15), fed by the live
 * `useAdapters()` catalog. One flat menu grouped by provider replaces the
 * older provider-select-plus-model-select pair: picking a model always names
 * its provider, so `adapterId` and `model` can never drift apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { ModelMenu } from '../ModelMenu';

function adapter(id: string, name: string, models: AdapterInfo['models']): AdapterInfo {
  return { id, name, description: '', installed: true, models, capabilities: { planMode: false } };
}

const CLAUDE = adapter('claude', 'Claude', [
  { id: 'sonnet-5', label: 'Sonnet 5', isDefault: true },
  { id: 'opus-4', label: 'Opus 4' },
]);
const CODEX = adapter('codex', 'Codex', [{ id: 'gpt-5', label: 'GPT-5', isDefault: true }]);

beforeEach(() => {
  resetAdapters();
  seedAdapters([CLAUDE, CODEX]);
});

afterEach(() => {
  resetAdapters();
});

describe('ModelMenu', () => {
  it('shows the resolved default model on the chip, naming its provider in the label', () => {
    render(<ModelMenu adapterId={undefined} model={undefined} onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-model');
    expect(chip).toHaveTextContent('Sonnet 5');
    expect(chip).toHaveAttribute('aria-label', 'Model: Claude · Sonnet 5');
  });

  it('shows the step’s own model when it is set', () => {
    render(<ModelMenu adapterId="claude" model="opus-4" onChange={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-model')).toHaveTextContent('Opus 4');
  });

  it('patches step.model when a model of the same provider is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelMenu adapterId="claude" model="sonnet-5" onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-model'));
    await user.click(screen.getByTestId('agent-a-model-option-claude-opus-4'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ adapterId: 'claude', model: 'opus-4' });
  });

  it('patches both adapterId and model when a model of another provider is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelMenu adapterId="claude" model="sonnet-5" onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-model'));
    await user.click(screen.getByTestId('agent-a-model-option-codex-gpt-5'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ adapterId: 'codex', model: 'gpt-5' });
  });

  it('groups the menu by provider so each model reads under its own agent', async () => {
    const user = userEvent.setup();
    render(<ModelMenu adapterId="claude" model="sonnet-5" onChange={vi.fn()} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-model'));
    const menu = screen.getByTestId('agent-a-model-menu');
    expect(menu).toHaveTextContent('Claude');
    expect(menu).toHaveTextContent('Codex');
  });

  it('renders a disabled chip when no agent is installed', () => {
    resetAdapters();
    render(<ModelMenu adapterId={undefined} model={undefined} onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-model');
    expect(chip).toHaveTextContent('No agents');
    expect(chip).toBeDisabled();
  });
});
