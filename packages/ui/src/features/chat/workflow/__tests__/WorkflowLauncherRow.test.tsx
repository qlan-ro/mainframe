/**
 * Behavior tests for WorkflowLauncherRow — the collapsed `Workflow`/`RunWorkflow`
 * tool card (AC 1-4). Fixed props/fixtures, hardcoded expected DOM — nothing here
 * recomputes the card's own parsing or dot-tone logic.
 *
 * Mocked seam: `../use-workflow-run` — the card looks the run up by taskId; the
 * fixture run is supplied directly rather than routed through chat state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClaudeWorkflowAgent, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';

let __run: ClaudeWorkflowRun | undefined;

vi.mock('../use-workflow-run', () => ({
  useWorkflowRun: () => __run,
}));

import { WorkflowLauncherRow } from '../WorkflowLauncherRow';

function agent(overrides: Partial<ClaudeWorkflowAgent> = {}): ClaudeWorkflowAgent {
  return {
    agentId: 'agent-1',
    index: 0,
    phaseIndex: 0,
    label: 'reviewer',
    state: 'done',
    tokens: 100,
    toolCalls: 2,
    durationMs: 5_000,
    ...overrides,
  };
}

function run(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'task-1',
    runId: 'run_1',
    workflowName: 'deploy',
    status: 'running',
    source: 'launch',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

const noop = () => {};
const baseProps = {
  type: 'tool-call' as const,
  toolName: 'Workflow',
  toolCallId: 'tc-wf-1',
  argsText: '',
  args: {},
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  isError: false as boolean | undefined,
  status: { type: 'complete' as const },
};

function launchResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: 'async_launched',
    taskId: 'task-1',
    runId: 'run_1',
    workflowName: 'deploy',
    ...overrides,
  });
}

describe('WorkflowLauncherRow', () => {
  beforeEach(() => {
    __run = undefined;
  });

  it('renders the launcher row keyed by runId with the workflow name and meta string (AC 1, 2)', () => {
    __run = run({
      status: 'completed',
      totalTokens: 500,
      durationMs: 90_000,
      agents: [agent()],
    });
    render(<WorkflowLauncherRow {...baseProps} result={launchResult()} />);
    const row = screen.getByTestId('chat-workflow-launcher-run_1');
    expect(row.textContent).toContain('deploy');
    expect(row.textContent).toContain('1 agent · 500 tok · 1m');
  });

  it('does not expand in place — no phase or agent content renders inside the row (AC 1)', () => {
    __run = run({
      phases: [{ index: 0, title: 'Plan' }],
      agents: [agent()],
    });
    render(<WorkflowLauncherRow {...baseProps} result={launchResult()} />);
    expect(screen.queryByTestId('chat-workflow-phase-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-agent-agent-1')).not.toBeInTheDocument();
  });

  it.each([
    ['completed', [agent({ state: 'done' })], 'green', false],
    ['completed', [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'error' })], 'amber', false],
    ['failed', [], 'red', false],
    ['running', [], 'amber', true],
    ['stopped', [], 'hollow', false],
    ['paused', [], 'hollow', false],
    ['unavailable', [], 'hollow', false],
  ] as const)('renders a %s outcome dot as tone=%s pulse=%s (AC 3)', (status, agents, tone, pulse) => {
    __run = run({ status, agents: [...agents] });
    render(<WorkflowLauncherRow {...baseProps} result={launchResult()} />);
    const dot = screen.getByTestId('chat-workflow-launcher-dot');
    expect(dot).toHaveAttribute('data-tone', tone);
    expect(dot).toHaveAttribute('data-pulse', String(pulse));
  });

  it('clicking the row opens a panel with no breadcrumb (AC 4)', async () => {
    const user = userEvent.setup();
    __run = run();
    render(<WorkflowLauncherRow {...baseProps} result={launchResult()} />);

    await user.click(screen.getByTestId('chat-workflow-launcher-run_1'));

    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-back-run_1')).not.toBeInTheDocument();
  });

  it('a launch-failure result renders a non-interactive row with a red dot and the error text', async () => {
    const user = userEvent.setup();
    render(<WorkflowLauncherRow {...baseProps} result={JSON.stringify({ error: 'workflow script not found' })} />);

    const row = screen.getByTestId('chat-workflow-launcher-tc-wf-1');
    expect(row.textContent).toContain('workflow script not found');
    expect(screen.getByTestId('chat-workflow-launcher-dot')).toHaveAttribute('data-tone', 'red');

    await user.click(row);
    expect(screen.queryByTestId(/^chat-workflow-panel-/)).not.toBeInTheDocument();
  });

  it('a tool call with no result yet renders immediately with a running dot', () => {
    render(<WorkflowLauncherRow {...baseProps} result={undefined} />);

    expect(screen.getByTestId('chat-workflow-launcher-tc-wf-1')).toBeInTheDocument();
    const dot = screen.getByTestId('chat-workflow-launcher-dot');
    expect(dot).toHaveAttribute('data-tone', 'amber');
    expect(dot).toHaveAttribute('data-pulse', 'true');
  });
});
