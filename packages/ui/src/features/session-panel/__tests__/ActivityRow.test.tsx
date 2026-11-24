import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ActivityEntry, ActivityKind } from '../activity-model';
import { ActivityRow } from '../ActivityRow';

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });
const onActivate = vi.fn();
const onJump = vi.fn();
const onStop = vi.fn();

const agent: ActivityEntry = {
  id: 'task:a-1',
  kind: 'subagent',
  title: 'Review',
  detail: 'explorer',
  state: 'running',
  startedAt: 0,
};

const run = {
  taskId: 'wf-1',
  status: 'running',
  source: 'snapshot',
  totalTokens: 0,
  durationMs: 0,
  phases: [
    { index: 1, title: 'Lint' },
    { index: 2, title: 'Typecheck' },
    { index: 3, title: 'Build' },
  ],
  agents: [
    { agentId: 'l', phaseIndex: 1, label: 'Lint all', state: 'done', durationMs: 18_000, tokens: 0, toolCalls: 0 },
    {
      agentId: 'ui',
      phaseIndex: 2,
      label: 'Typecheck ui',
      state: 'progress',
      durationMs: 72_000,
      tokens: 0,
      toolCalls: 0,
    },
    { agentId: 'rs', phaseIndex: 2, label: 'Typecheck rs', state: 'done', durationMs: 5_000, tokens: 0, toolCalls: 0 },
  ],
} as unknown as ClaudeWorkflowRun;
const workflow: ActivityEntry = { ...agent, id: 'task:wf-1', kind: 'workflow', title: 'release-checks' };

beforeEach(() => vi.clearAllMocks());

describe('ActivityRow', () => {
  it.each([
    ['subagent', 'lucide-bot'],
    ['delegated', 'lucide-bot-filled'],
    ['workflow', 'lucide-route'],
    ['monitor', 'lucide-binoculars'],
    ['command', 'lucide-square-terminal'],
    ['scheduled', 'lucide-clock-3'],
  ] as [ActivityKind, string][])('leads with the %s icon, live or finished', (kind, icon) => {
    const view = render(<ActivityRow row={{ ...agent, kind }} now={60_000} onActivate={onActivate} />);
    expect(view.container.querySelector(`.${icon}`)).not.toBeNull();
    view.rerender(
      <ActivityRow row={{ ...agent, kind, state: 'failed', endedAt: 1 }} now={60_000} onActivate={onActivate} />,
    );
    expect(view.container.querySelector(`.${icon}`)).not.toBeNull();
  });

  it('spells out kind, title and status for screen readers', () => {
    const view = render(<ActivityRow row={agent} now={240_000} onActivate={onActivate} />);
    expect(screen.getByRole('button', { name: 'Agent: Review, running, 4m' })).toBeInTheDocument();
    view.rerender(<ActivityRow row={{ ...agent, state: 'needs-you' }} now={240_000} onActivate={onActivate} />);
    expect(screen.getByRole('button', { name: 'Agent: Review, needs you' })).toBeInTheDocument();
  });

  it("runs the row's main action on click, without unfolding", () => {
    render(<ActivityRow row={agent} now={60_000} onActivate={onActivate} onJump={onJump} onStop={onStop} />);
    const row = screen.getByTestId('session-panel-activity-task:a-1');
    expect(row).not.toHaveAttribute('aria-expanded');
    fireEvent.click(row);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(screen.queryByText('Stop')).toBeNull();
  });

  it('keeps Stop and the transcript one right-click away', async () => {
    render(<ActivityRow row={agent} now={60_000} onActivate={onActivate} onJump={onJump} onStop={onStop} />);
    fireEvent.contextMenu(screen.getByTestId('session-panel-activity-task:a-1'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('offers Stop to the keyboard beside the row, and only while it can be stopped', async () => {
    const view = render(<ActivityRow row={agent} now={60_000} onActivate={onActivate} onStop={onStop} />);
    await userEvent.tab();
    expect(screen.getByTestId('session-panel-activity-task:a-1')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Stop Review' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onStop).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();

    view.rerender(<ActivityRow row={{ ...agent, state: 'completed', endedAt: 1 }} now={1} onActivate={onActivate} />);
    expect(screen.queryByRole('button', { name: 'Stop Review' })).toBeNull();
  });

  it('says it is stopping until the work ends', async () => {
    render(<ActivityRow row={agent} now={60_000} onActivate={onActivate} onStop={onStop} stopping />);
    expect(screen.getByRole('button', { name: 'Agent: Review, stopping' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stopping Review' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.contextMenu(screen.getByTestId('session-panel-activity-task:a-1'));
    expect(await screen.findByRole('menuitem', { name: 'Stop' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ActivityRow — a background command’s output', () => {
  const command: ActivityEntry = { ...agent, kind: 'command', title: 'Build', command: 'pnpm build' };
  const openOutput = async () => {
    fireEvent.contextMenu(screen.getByTestId('session-panel-activity-task:a-1'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Full output' }));
    return within(await screen.findByRole('dialog', { name: 'Build' }));
  };

  it('opens from the row menu, reads once, and gives focus back to the row', async () => {
    const read = vi.fn().mockResolvedValue('✓ built in 42s');
    render(<ActivityRow row={command} now={1} onActivate={onActivate} readOutput={read} />);
    expect(read).not.toHaveBeenCalled();
    const dialog = await openOutput();
    expect(await dialog.findByText('✓ built in 42s')).toBeInTheDocument();
    expect(dialog.getByText('pnpm build')).toBeInTheDocument();
    expect(read).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('session-panel-activity-task:a-1')).toHaveFocus());
  });

  it('says when there is none, and when it could not be read', async () => {
    const read = vi.fn().mockResolvedValueOnce('').mockRejectedValueOnce(new Error('Output request failed (500)'));
    render(<ActivityRow row={command} now={1} onActivate={onActivate} readOutput={read} />);
    expect(await (await openOutput()).findByText('No output')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await (await openOutput()).findByRole('alert')).toHaveTextContent('Output request failed (500)');
  });
});

describe('ActivityRow — workflow', () => {
  it('unfolds its numbered phases and the running phase’s running agents', () => {
    render(<ActivityRow row={workflow} run={run} now={60_000} onActivate={onActivate} onStop={onStop} />);
    const row = screen.getByTestId('session-panel-activity-task:wf-1');
    expect(row).toHaveTextContent('phase 2 of 3');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(onActivate).not.toHaveBeenCalled();

    const phases = within(screen.getByRole('list', { name: 'release-checks phases' }));
    expect(phases.getAllByRole('listitem').map((item) => item.getAttribute('data-status'))).toEqual([
      'done',
      'running',
      'pending',
    ]);
    expect(screen.getByTestId('session-panel-workflow-phase-1')).toHaveTextContent('1. Lint');
    expect(screen.getByTestId('session-panel-workflow-phase-1')).toHaveTextContent('18s');
    // Side by side, so the longest agent: 72s, not 72s + 5s.
    expect(screen.getByTestId('session-panel-workflow-phase-2')).toHaveTextContent('1m 12s');
    expect(screen.getByTestId('session-panel-workflow-phase-3')).toHaveTextContent('waiting');
    expect(screen.getByRole('button', { name: /Open Typecheck ui/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Typecheck rs/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Lint all/ })).toBeNull();
  });

  it('stops the run from its unfolded row, and offers no Stop once it ended', () => {
    const view = render(<ActivityRow row={workflow} run={run} now={60_000} onActivate={onActivate} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('session-panel-activity-task:wf-1'));
    fireEvent.click(screen.getByTestId('session-panel-workflow-stop'));
    expect(onStop).toHaveBeenCalledOnce();

    view.rerender(
      <ActivityRow
        row={{ ...workflow, state: 'stopped', endedAt: 1 }}
        run={{ ...run, status: 'stopped' }}
        now={60_000}
        onActivate={onActivate}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Stop release-checks' })).toBeNull();
    expect(screen.getByTestId('session-panel-workflow-phase-2')).not.toHaveAttribute('data-status', 'running');
  });

  it('opens the run’s detail from a running agent', async () => {
    render(<ActivityRow row={workflow} run={run} now={60_000} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('session-panel-activity-task:wf-1'));
    await userEvent.click(screen.getByTestId('session-panel-workflow-agent-ui'));
    expect(await screen.findByTestId('chat-workflow-panel-wf-1')).toBeInTheDocument();
  });

  it('jumps instead when no run is known', () => {
    render(<ActivityRow row={workflow} now={60_000} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('session-panel-activity-task:wf-1'));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('lists the agents no phase names, with their state', () => {
    const orphaned = {
      ...run,
      agents: [
        ...run.agents,
        { ...run.agents[0]!, agentId: 'x', phaseIndex: 9, label: 'Stray check', state: 'error', durationMs: 4_000 },
        { ...run.agents[0]!, agentId: 'y', phaseIndex: 9, label: 'Stray build', state: 'progress' },
      ],
    } as ClaudeWorkflowRun;
    render(<ActivityRow row={workflow} run={orphaned} now={60_000} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('session-panel-activity-task:wf-1'));
    const strays = within(screen.getByRole('group', { name: 'Agents outside the phases' }));
    expect(strays.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open Stray check, failed, 4s',
      'Open Stray build, running, 18s',
    ]);
  });

  it('lists every agent of a run that has no phases', () => {
    render(<ActivityRow row={workflow} run={{ ...run, phases: [] }} now={60_000} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('session-panel-activity-task:wf-1'));
    expect(screen.queryByText(/No phases/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  });
});
