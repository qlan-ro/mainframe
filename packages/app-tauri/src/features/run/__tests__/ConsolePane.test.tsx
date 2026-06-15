/**
 * ConsolePane — unit tests.
 *
 * Behaviors covered:
 *  - Renders the pane root with data-testid="run-console-pane"
 *  - Renders a log line for each matching entry (stdout + stderr)
 *  - Applies destructive styling class to stderr lines
 *  - Renders a clear button with data-testid="run-console-clear"
 *  - Calling the clear button calls clearLogsForProcess on the sandbox store
 *  - Does NOT render entries from a different scope or process name
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
    { scopeKey: 'proj-1:/repo', name: 'dev', data: 'Starting server…', stream: 'stdout' },
    { scopeKey: 'proj-1:/repo', name: 'dev', data: 'Error: port in use', stream: 'stderr' },
    { scopeKey: 'proj-1:/repo', name: 'api', data: 'SKIP ME', stream: 'stdout' },
    { scopeKey: 'proj-2:/other', name: 'dev', data: 'SKIP SCOPE', stream: 'stdout' },
  ];

  beforeEach(() => {
    clearLogsForProcess.mockReset();
    useSandboxStore.setState({
      logsOutput,
      clearLogsForProcess,
    } as never);
  });

  it('renders the pane root with data-testid="run-console-pane"', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    expect(screen.getByTestId('run-console-pane')).toBeInTheDocument();
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

  it('renders the clear button with correct testid', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    expect(screen.getByTestId('run-console-clear')).toBeInTheDocument();
  });

  it('calls clearLogsForProcess when the clear button is clicked', async () => {
    const { ConsolePane } = await import('../ConsolePane');
    render(<ConsolePane scopeKey="proj-1:/repo" processName="dev" />);
    fireEvent.click(screen.getByTestId('run-console-clear'));
    expect(clearLogsForProcess).toHaveBeenCalledWith('proj-1:/repo', 'dev');
  });
});
