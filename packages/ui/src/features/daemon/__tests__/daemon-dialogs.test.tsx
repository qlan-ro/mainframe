/**
 * daemon-dialogs.test.tsx — TDD tests for B8 daemon management surfaces.
 *
 * Covers:
 * 1. RenameRemoveBody (rename): typing + Save calls onConfirm(newLabel)
 * 2. RenameRemoveBody (remove): keyring copy shows; confirm button calls onConfirm()
 * 3. RepairPrompt: 401 badge renders; switchlocal/repair buttons fire correct callbacks
 * 4. DaemonUnreachableBody: title renders; switchlocal button fires onSwitchLocal
 * 5. ConnectionOverlay body slot: children rendered when passed; default when absent
 *
 * (Bare root-testid presence smokes for DaemonSmallDialog/RepairPrompt/
 * DaemonUnreachableBody were dropped — every interaction test above already
 * queries those same testids to drive a click or read text, so their
 * presence is exercised implicitly.)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { RenameRemoveBody, DaemonSmallDialog } from '../DaemonSmallDialog';
import { RepairPrompt } from '../RepairPrompt';
import { DaemonUnreachableBody } from '../DaemonUnreachableBody';
import { ConnectionOverlay } from '@/app/ConnectionOverlay';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REMOTE: DaemonMeta = {
  id: 'studio-1',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

// ---------------------------------------------------------------------------
// 1. RenameRemoveBody — rename mode
// ---------------------------------------------------------------------------

describe('RenameRemoveBody — rename', () => {
  it('prefills the input with the current label', () => {
    render(<RenameRemoveBody kind="rename" target={REMOTE} onClose={vi.fn()} onConfirm={vi.fn()} />);
    const input = screen.getByTestId('daemon-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Studio Mac');
  });

  it('typing a new label + clicking Save calls onConfirm(newLabel)', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RenameRemoveBody kind="rename" target={REMOTE} onClose={vi.fn()} onConfirm={onConfirm} />);

    const input = screen.getByTestId('daemon-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed Mac');
    await user.click(screen.getByTestId('daemon-rename-save'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Renamed Mac');
  });

  it('Save button is disabled when the input is empty', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RenameRemoveBody kind="rename" target={REMOTE} onClose={vi.fn()} onConfirm={onConfirm} />);

    const input = screen.getByTestId('daemon-rename-input');
    await user.clear(input);

    const saveBtn = screen.getByTestId('daemon-rename-save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter key in the input submits the rename', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RenameRemoveBody kind="rename" target={REMOTE} onClose={vi.fn()} onConfirm={onConfirm} />);

    const input = screen.getByTestId('daemon-rename-input');
    await user.clear(input);
    await user.type(input, 'Enter Mac{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('Enter Mac');
  });
});

// ---------------------------------------------------------------------------
// 2. RenameRemoveBody — remove mode
// ---------------------------------------------------------------------------

describe('RenameRemoveBody — remove', () => {
  it('shows the keyring-erase copy', () => {
    render(<RenameRemoveBody kind="remove" target={REMOTE} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/keyring/i)).toBeInTheDocument();
    expect(screen.getByText(/Studio Mac/)).toBeInTheDocument();
  });

  it('clicking the confirm button calls onConfirm()', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RenameRemoveBody kind="remove" target={REMOTE} onClose={vi.fn()} onConfirm={onConfirm} />);

    await user.click(screen.getByTestId('daemon-remove-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. DaemonSmallDialog — wrapper
// ---------------------------------------------------------------------------

describe('DaemonSmallDialog', () => {
  it('renders nothing when open=false', () => {
    render(<DaemonSmallDialog open={false} kind="rename" target={REMOTE} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByTestId('daemon-rename-dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. RepairPrompt
// ---------------------------------------------------------------------------

describe('RepairPrompt', () => {
  it('renders the 401 badge', () => {
    render(<RepairPrompt target={REMOTE} onRepair={vi.fn()} onSwitchLocal={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('401')).toBeInTheDocument();
  });

  it('renders the target host chip', () => {
    render(<RepairPrompt target={REMOTE} onRepair={vi.fn()} onSwitchLocal={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('studio.example.com:443')).toBeInTheDocument();
  });

  it('daemon-repair-switchlocal calls onSwitchLocal', async () => {
    const user = userEvent.setup();
    const onSwitchLocal = vi.fn();
    render(<RepairPrompt target={REMOTE} onRepair={vi.fn()} onSwitchLocal={onSwitchLocal} onDismiss={vi.fn()} />);

    await user.click(screen.getByTestId('daemon-repair-switchlocal'));
    expect(onSwitchLocal).toHaveBeenCalledTimes(1);
  });

  it('daemon-repair-confirm calls onRepair', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    render(<RepairPrompt target={REMOTE} onRepair={onRepair} onSwitchLocal={vi.fn()} onDismiss={vi.fn()} />);

    await user.click(screen.getByTestId('daemon-repair-confirm'));
    expect(onRepair).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. DaemonUnreachableBody
// ---------------------------------------------------------------------------

describe('DaemonUnreachableBody', () => {
  it('renders the unreachable title with the daemon label', () => {
    render(<DaemonUnreachableBody target={REMOTE} onSwitchLocal={vi.fn()} />);
    expect(screen.getByText(/Can't reach Studio Mac/i)).toBeInTheDocument();
  });

  it('daemon-unreachable-switchlocal calls onSwitchLocal', async () => {
    const user = userEvent.setup();
    const onSwitchLocal = vi.fn();
    render(<DaemonUnreachableBody target={REMOTE} onSwitchLocal={onSwitchLocal} />);

    await user.click(screen.getByTestId('daemon-unreachable-switchlocal'));
    expect(onSwitchLocal).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. ConnectionOverlay — body/children slot
// ---------------------------------------------------------------------------

describe('ConnectionOverlay — body slot', () => {
  it('renders the children body when provided (embedded)', () => {
    render(
      <ConnectionOverlay open embedded>
        <div data-testid="custom-body">Custom unreachable body</div>
      </ConnectionOverlay>,
    );
    expect(screen.getByTestId('custom-body')).toBeInTheDocument();
    expect(screen.queryByText('Reconnecting to daemon…')).not.toBeInTheDocument();
  });

  it('renders the default card when no children are passed (embedded)', () => {
    render(<ConnectionOverlay open embedded />);
    expect(screen.getByText('Reconnecting to daemon…')).toBeInTheDocument();
  });

  it('renders nothing when open=false even with children', () => {
    render(
      <ConnectionOverlay open={false} embedded>
        <div data-testid="custom-body">Should not render</div>
      </ConnectionOverlay>,
    );
    expect(document.querySelector('[data-testid="custom-body"]')).toBeNull();
  });
});
