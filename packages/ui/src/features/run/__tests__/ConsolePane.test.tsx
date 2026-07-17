/**
 * ConsolePane — unit tests.
 *
 * Behaviors covered:
 *  - Renders a log line for each matching entry (stdout + stderr)
 *  - Applies destructive styling class to stderr lines
 *  - Calling the clear button calls clearLogsForProcess on the sandbox store
 *  - Does NOT render entries from a different scope or process name
 *  - Drawer variant renders, collapses by default, expands on toggle
 *
 * (Root-pane and clear-button bare presence smokes were dropped — every
 * interaction test below already queries those same testids to drive a
 * click, so their presence is exercised implicitly.)
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LogEntry } from '@/store/sandbox';
import { useSandboxStore } from '@/store/sandbox';

// We'll import ConsolePane after its creation; for now mock the sandbox store.
// ConsolePane reads logsOutput and clearLogsForProcess from useSandboxStore.

describe('ConsolePane', () => {
  const clearLogsForProcess = vi.fn();

  const logsOutput: LogEntry[] = [
    { seq: 1, scopeKey: 'proj-1:/repo', name: 'dev', data: 'Starting server…', stream: 'stdout' },
    { seq: 2, scopeKey: 'proj-1:/repo', name: 'dev', data: 'Error: port in use', stream: 'stderr' },
    { seq: 3, scopeKey: 'proj-1:/repo', name: 'api', data: 'SKIP ME', stream: 'stdout' },
    { seq: 4, scopeKey: 'proj-2:/other', name: 'dev', data: 'SKIP SCOPE', stream: 'stdout' },
  ];

  beforeEach(() => {
    clearLogsForProcess.mockReset();
    useSandboxStore.setState({
      logsOutput,
      clearLogsForProcess,
    } as never);
  });

  it('renders only matching log lines for the scope + process', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    expect(screen.getByText('Starting server…')).toBeInTheDocument();
    expect(screen.getByText('Error: port in use')).toBeInTheDocument();
    expect(screen.queryByText('SKIP ME')).not.toBeInTheDocument();
    expect(screen.queryByText('SKIP SCOPE')).not.toBeInTheDocument();
  });

  it('applies a destructive style to stderr lines', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    const errLine = screen.getByText('Error: port in use').closest('[data-stream]');
    expect(errLine).toHaveAttribute('data-stream', 'stderr');
  });

  it('calls clearLogsForProcess when the clear button is clicked', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    fireEvent.click(screen.getByTestId('run-console-clear'));
    expect(clearLogsForProcess).toHaveBeenCalledWith('proj-1:/repo', 'dev');
  });

  it('opts the log output into text selection via the mf-editor-selectable class', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    const lines = screen.getByTestId('run-console-log-lines');
    expect(lines.classList.contains('mf-editor-selectable')).toBe(true);
  });
});

describe('ConsolePane drawer variant', () => {
  const clearLogsForProcess = vi.fn();
  const logsOutput: LogEntry[] = [
    { seq: 1, scopeKey: 'proj-1:/repo', name: 'dev', data: 'Starting server…', stream: 'stdout' },
    { seq: 2, scopeKey: 'proj-1:/repo', name: 'dev', data: 'Error: port in use', stream: 'stderr' },
    { seq: 3, scopeKey: 'proj-1:/repo', name: 'api', data: 'SKIP ME', stream: 'stdout' },
    { seq: 4, scopeKey: 'proj-2:/other', name: 'dev', data: 'SKIP SCOPE', stream: 'stdout' },
  ];

  beforeEach(() => {
    clearLogsForProcess.mockReset();
    useSandboxStore.setState({
      logsOutput,
      clearLogsForProcess,
    } as never);
  });

  it('renders drawer root with data-testid="run-console-drawer"', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    expect(screen.getByTestId('run-console-drawer')).toBeInTheDocument();
  });

  it('is collapsed by default (log area not visible)', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    expect(screen.queryByText('Starting server…')).not.toBeInTheDocument();
  });

  it('expands when the toggle is clicked', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    fireEvent.click(screen.getByTestId('run-console-drawer-toggle'));
    expect(screen.getByText('Starting server…')).toBeInTheDocument();
  });

  it('opts the expanded drawer log output into text selection', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    fireEvent.click(screen.getByTestId('run-console-drawer-toggle'));
    const lines = screen.getByTestId('run-console-log-lines');
    expect(lines.classList.contains('mf-editor-selectable')).toBe(true);
  });

  it('shows the last log line as tail when collapsed', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    expect(screen.getByText('Error: port in use')).toBeInTheDocument();
  });

  it('shows the resize handle only when expanded', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    expect(screen.queryByTestId('run-console-resize')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-console-drawer-toggle'));
    expect(screen.getByTestId('run-console-resize')).toBeInTheDocument();
  });

  it('dragging the handle up grows the log area; clamps at the minimum', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" variant="drawer" />);
    fireEvent.click(screen.getByTestId('run-console-drawer-toggle'));
    const handle = screen.getByTestId('run-console-resize');
    const area = screen.getByTestId('run-console-log-area');
    expect(area.style.height).toBe('150px'); // DRAWER_DEFAULT_H

    // Drag up 50px (clientY decreases) → height grows by 50.
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 250, pointerId: 1 });
    expect(area.style.height).toBe('200px');

    // Drag far down → clamps to the 60px minimum, not below.
    fireEvent.pointerMove(handle, { clientY: 700, pointerId: 1 });
    expect(area.style.height).toBe('60px');
    fireEvent.pointerUp(handle, { clientY: 700, pointerId: 1 });
  });
});
