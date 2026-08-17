/**
 * PermissionMenu — the Agent card's execution-scope chip (todo #234 T15),
 * over the contract's own `EXECUTION_MODES`. Unattended is the one mode that
 * runs without a human in the loop, so the chip goes destructive on it; Auto
 * is a caution, and it only appears for a provider whose adapter advertises
 * `capabilities.autoMode` (todo #325).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import { EXECUTION_MODES } from '../../../contract';
import { PermissionMenu } from '../PermissionMenu';

function adapter(id: string, name: string, capabilities: AdapterInfo['capabilities']): AdapterInfo {
  return { id, name, description: '', installed: true, models: [], capabilities };
}

const CLAUDE = adapter('claude', 'Claude', { planMode: true, autoMode: true });
/** No `autoMode` key at all — absent means unsupported, the mobile-additive case. */
const CODEX = adapter('codex', 'Codex', { planMode: false });

beforeEach(() => {
  resetAdapters();
  seedAdapters([CLAUDE, CODEX]);
});

afterEach(() => {
  resetAdapters();
});

describe('PermissionMenu', () => {
  it('defaults to the first execution mode when the step carries none', () => {
    render(<PermissionMenu adapterId="claude" value={undefined} onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-permission');
    expect(chip).toHaveTextContent('Interactive');
    expect(chip).toHaveAttribute('aria-label', 'Permission: Interactive');
  });

  it('falls back to the first mode when the wire carries one this build does not know', () => {
    render(<PermissionMenu adapterId="claude" value="plan" onChange={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-permission')).toHaveTextContent('Interactive');
  });

  it('offers every contract execution mode on a provider that supports them all', async () => {
    const user = userEvent.setup();
    render(<PermissionMenu adapterId="claude" value="default" onChange={vi.fn()} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-permission'));
    for (const mode of EXECUTION_MODES) {
      expect(screen.getByTestId(`agent-a-permission-option-${mode}`)).toBeInTheDocument();
    }
  });

  it('omits Auto for a provider whose adapter does not advertise it', async () => {
    const user = userEvent.setup();
    render(<PermissionMenu adapterId="codex" value="default" onChange={vi.fn()} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-permission'));
    expect(screen.queryByTestId('agent-a-permission-option-auto')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-a-permission-option-yolo')).toBeInTheDocument();
  });

  it('patches the permission mode on pick', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PermissionMenu adapterId="claude" value="default" onChange={onChange} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-permission'));
    await user.click(screen.getByTestId('agent-a-permission-option-acceptEdits'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ permissionMode: 'acceptEdits' });
  });

  it('renders the chip destructive on yolo only', () => {
    const { rerender } = render(
      <PermissionMenu adapterId="claude" value="acceptEdits" onChange={vi.fn()} testId="agent-a" />,
    );
    expect(screen.getByTestId('agent-a-permission').className).not.toContain('text-destructive');

    rerender(<PermissionMenu adapterId="claude" value="yolo" onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-permission');
    expect(chip).toHaveTextContent('Unattended');
    expect(chip.className).toContain('text-destructive');
  });

  it('renders the chip as a caution on auto, never as destructive', () => {
    render(<PermissionMenu adapterId="claude" value="auto" onChange={vi.fn()} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-permission');
    expect(chip).toHaveTextContent('Auto');
    expect(chip.className).toContain('text-warning');
    expect(chip.className).not.toContain('text-destructive');
  });

  it('still labels a stored auto mode on a provider that cannot offer it', () => {
    render(<PermissionMenu adapterId="codex" value="auto" onChange={vi.fn()} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-permission')).toHaveTextContent('Auto');
  });
});
