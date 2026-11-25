/**
 * Behavior tests for WorkflowRow — the `Workflow`/`RunWorkflow` call's row (AC 1-4). Fixed props/fixtures, hardcoded expected DOM — nothing here
 * recomputes the row's own parsing or status logic.
 *
 * Mocked seam: `../use-workflow-run` — the row looks the run up by taskId; the
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

vi.mock('../../tools/chat-tool-context', () => ({ useChatId: () => undefined }));
vi.mock('../../messages/turn/turn-context', async (original) => ({
  ...(await original<object>()),
  useTurnSelector: (_select: unknown, fallback: unknown) => (typeof fallback === 'boolean' ? false : fallback),
}));

import { TranscriptScopeProvider } from '../../messages/turn/transcript-scope';
import { WorkflowRow } from '../WorkflowRow';
import type { ToolPart } from '../../view-model/turn/types';

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

let rows = 0;
interface RowProps {
  result?: unknown;
  isError?: boolean;
  turnKey?: string;
  live?: boolean;
}
function Row({ result, isError, turnKey, live = true }: RowProps) {
  const part = {
    type: 'tool-call',
    toolName: 'Workflow',
    toolCallId: 'tc-wf-1',
    argsText: '',
    args: {},
    isError,
    status: { type: 'complete' },
    ...(result === undefined ? { providerMetadata: { mainframe: { acpStatus: 'in_progress' } } } : { result }),
  } as unknown as ToolPart;
  return (
    <TranscriptScopeProvider value={{ rootThreadId: 'r', ancestors: [], pendingToolIds: new Set(), live }}>
      <WorkflowRow unit={{ key: `row-${++rows}`, messageId: 'm', index: 0, part }} part={part} turnKey={turnKey} />
    </TranscriptScopeProvider>
  );
}
const glyphWord = (id: string) => screen.getByTestId(id).querySelector('.sr-only')!.textContent;

function launchResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: 'async_launched',
    taskId: 'task-1',
    runId: 'run_1',
    workflowName: 'deploy',
    ...overrides,
  });
}

describe('WorkflowRow', () => {
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
    render(<Row result={launchResult()} />);
    const row = screen.getByTestId('chat-workflow-launcher-run_1');
    expect(row.textContent).toContain('deploy');
    expect(row.textContent).toContain('1 agent · 500 tok · 1m');
  });

  it('does not expand in place — no phase or agent content renders inside the row (AC 1)', () => {
    __run = run({
      phases: [{ index: 0, title: 'Plan' }],
      agents: [agent()],
    });
    render(<Row result={launchResult()} />);
    expect(screen.queryByTestId('chat-workflow-phase-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-agent-agent-1')).not.toBeInTheDocument();
  });

  it.each([
    ['completed', [agent({ state: 'done' })], 'Done: '],
    // A run with failed agents still completed; its receipt counts them.
    ['completed', [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'error' })], 'Done: '],
    ['failed', [], 'Failed: '],
    ['running', [], 'Running: '],
    ['stopped', [], 'Stopped: '],
    ['paused', [], 'Stopped: '],
    ['unavailable', [], 'No result recorded: '],
  ] as const)('says where a %s run stands (AC 3)', (status, agents, word) => {
    __run = run({ status, agents: [...agents] });
    render(<Row result={launchResult()} />);
    expect(glyphWord('chat-workflow-launcher-run_1')).toBe(word);
  });

  it('clicking the row opens a panel with no breadcrumb (AC 4)', async () => {
    const user = userEvent.setup();
    __run = run();
    render(<Row result={launchResult()} />);

    await user.click(screen.getByTestId('chat-workflow-launcher-open-run_1'));

    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-back-run_1')).not.toBeInTheDocument();
  });

  it('shows why a launch failed, with no run to open', () => {
    render(<Row result={JSON.stringify({ error: 'workflow script not found' })} />);
    const row = screen.getByTestId('chat-workflow-launcher-tc-wf-1');
    expect(row.textContent).toContain('workflow script not found');
    expect(glyphWord('chat-workflow-launcher-tc-wf-1')).toBe('Failed: ');
    expect(row.querySelector('[data-testid^="chat-workflow-launcher-open-"]')).toBeNull();
  });

  it('opens a launch that failed in prose on what it said', async () => {
    render(<Row result="Permission to use Workflow was denied" isError />);
    const row = screen.getByTestId('chat-workflow-launcher-tc-wf-1');
    expect(glyphWord('chat-workflow-launcher-tc-wf-1')).toBe('Failed: ');
    await userEvent.click(screen.getByTestId('chat-workflow-launcher-tc-wf-1-toggle'));
    expect(row).toHaveTextContent('Permission to use Workflow was denied');
  });

  it('claims neither work nor an end when its record says running but its turn ended and no task is left', () => {
    __run = run({ status: 'running' });
    const { rerender } = render(<Row result={launchResult()} turnKey="t" live={false} />);
    expect(glyphWord('chat-workflow-launcher-run_1')).toBe('No result recorded: ');
    rerender(<Row result={launchResult()} turnKey="t" live />);
    expect(glyphWord('chat-workflow-launcher-run_1')).toBe('Running: ');
  });

  it('renders at once while the call is in flight', () => {
    render(<Row />);
    expect(screen.getByTestId('chat-workflow-launcher-tc-wf-1')).toHaveTextContent('Starting workflow');
    expect(glyphWord('chat-workflow-launcher-tc-wf-1')).toBe('Running: ');
  });

  it('can be found by its call', () => {
    render(<Row result={launchResult()} />);
    expect(screen.getByTestId('chat-workflow-launcher-run_1')).toHaveAttribute('data-activity-id', 'tc-wf-1');
  });
});
