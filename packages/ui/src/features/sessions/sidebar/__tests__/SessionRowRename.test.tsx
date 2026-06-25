/**
 * SessionRowRename — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - Renders an <input> with data-testid="sessions-rename-input" pre-filled
 *    with the value of the `initialTitle` prop.
 *  - On blur with unchanged value "Old title", calls onCancel (not onCommit).
 *  - On blur with changed value "New title", calls onCommit with "New title".
 *  - Pressing Escape calls onCancel and does NOT call onCommit.
 *  - Pressing Enter with value "New title" calls onCommit("New title").
 *  - Pressing Enter with empty/whitespace value calls onCancel (no-op).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionRowRename } from '../SessionRowRename';

// ---------------------------------------------------------------------------
// 1. Input renders with the initialTitle pre-filled
// ---------------------------------------------------------------------------

describe('SessionRowRename — renders input pre-filled with initialTitle', () => {
  it('renders data-testid="sessions-rename-input" with value "Old title"', () => {
    render(<SessionRowRename initialTitle="Old title" onCommit={() => undefined} onCancel={() => undefined} />);
    const input = screen.getByTestId('sessions-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Old title');
  });
});

// ---------------------------------------------------------------------------
// 2. Blur with unchanged value calls onCancel, not onCommit
// ---------------------------------------------------------------------------

describe('SessionRowRename — blur with unchanged value calls onCancel', () => {
  it('calls onCancel (not onCommit) when blurred with the same value "Old title"', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRowRename initialTitle="Old title" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByTestId('sessions-rename-input');
    await userEvent.click(input);
    await userEvent.tab(); // triggers blur without changing value

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Blur with changed value calls onCommit with the new string
// ---------------------------------------------------------------------------

describe('SessionRowRename — blur with changed value calls onCommit', () => {
  it('calls onCommit("New title") when blurred after typing "New title"', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRowRename initialTitle="Old title" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByTestId('sessions-rename-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'New title');
    await userEvent.tab(); // triggers blur

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New title');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Escape calls onCancel and does NOT call onCommit
// ---------------------------------------------------------------------------

describe('SessionRowRename — Escape calls onCancel and not onCommit', () => {
  it('calls onCancel (not onCommit) when Escape is pressed', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRowRename initialTitle="Old title" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByTestId('sessions-rename-input');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Enter with changed value calls onCommit with that value
// ---------------------------------------------------------------------------

describe('SessionRowRename — Enter with changed value calls onCommit', () => {
  it('calls onCommit("New title") when Enter is pressed after typing "New title"', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRowRename initialTitle="Old title" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByTestId('sessions-rename-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'New title');
    await userEvent.keyboard('{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New title');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Enter with empty/whitespace value calls onCancel (no-op)
// ---------------------------------------------------------------------------

describe('SessionRowRename — Enter with empty/whitespace calls onCancel', () => {
  it('calls onCancel (not onCommit) when Enter is pressed with whitespace-only value', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRowRename initialTitle="Old title" onCommit={onCommit} onCancel={onCancel} />);

    const input = screen.getByTestId('sessions-rename-input');
    await userEvent.clear(input);
    await userEvent.type(input, '   ');
    await userEvent.keyboard('{Enter}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
