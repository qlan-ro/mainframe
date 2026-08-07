/**
 * Behavior tests for WorkflowRunPanel — the run detail panel (AC 7-11, 16, 18, 19).
 * Fixed run fixtures, hardcoded expected DOM — nothing here recomputes the panel's
 * own neutralization, chip or summary logic.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ClaudeWorkflowAgent, ClaudeWorkflowPhase, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { WorkflowRunPanel } from '../WorkflowRunPanel';

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

function phase(overrides: Partial<ClaudeWorkflowPhase> = {}): ClaudeWorkflowPhase {
  return { index: 0, title: 'Review', ...overrides };
}

function run(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'task-1',
    runId: 'run_1',
    workflowName: 'deploy',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe('WorkflowRunPanel — header (AC 7)', () => {
  it('shows the workflow name, status chip, and right-aligned run tokens/duration', () => {
    render(<WorkflowRunPanel run={run({ status: 'completed', totalTokens: 500, durationMs: 90_000 })} />);
    const panel = screen.getByTestId('chat-workflow-panel-run_1');
    expect(panel.textContent).toContain('deploy');
    expect(panel.textContent).toContain('Completed');
    expect(panel.textContent).toContain('500 tok');
    expect(panel.textContent).toContain('1m');
  });
});

describe('WorkflowRunPanel — phases (AC 9)', () => {
  it('renders every seeded phase in index order', () => {
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0, title: 'Plan' }), phase({ index: 1, title: 'Build' })],
          agents: [agent({ phaseIndex: 0 })],
        })}
      />,
    );
    const phase0 = screen.getByTestId('chat-workflow-phase-0');
    const phase1 = screen.getByTestId('chat-workflow-phase-1');
    expect(phase0.textContent).toContain('Plan');
    expect(phase1.textContent).toContain('Build');
  });

  it('a phase with no agents reads "not started"', () => {
    render(<WorkflowRunPanel run={run({ phases: [phase({ index: 0, title: 'Plan' })], agents: [] })} />);
    expect(screen.getByTestId('chat-workflow-phase-0').textContent).toContain('not started');
  });
});

describe('WorkflowRunPanel — agent rows (AC 10, D19)', () => {
  it('renders agents under their phase in index order with state dot, label, tokens and duration', () => {
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0, title: 'Plan' })],
          agents: [agent({ agentId: 'a-1', label: 'planner', tokens: 300, durationMs: 12_000 })],
        })}
      />,
    );
    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(row.textContent).toContain('planner');
    expect(row.textContent).toContain('300');
    expect(row.textContent).toContain('12s');
  });

  it('carries model, attempt and tool count in the row title, not the visible row', () => {
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0 })],
          agents: [
            agent({
              agentId: 'a-1',
              model: 'claude-opus-4',
              attempt: 2,
              toolCalls: 7,
            }),
          ],
        })}
      />,
    );
    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(row).toHaveAttribute('title', expect.stringContaining('claude-opus-4'));
    expect(row).toHaveAttribute('title', expect.stringContaining('2'));
    expect(row).toHaveAttribute('title', expect.stringContaining('7'));
    // The visible row text carries no tool-call count (D19) — only tokens/duration metrics.
    expect(row.textContent).not.toContain('7 tool');
  });
});

describe('WorkflowRunPanel — error-state agent (AC 11)', () => {
  it("shows the agent's error text as the single detail line", () => {
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0 })],
          agents: [agent({ agentId: 'a-1', state: 'error', error: 'workflow script exited 1' })],
        })}
      />,
    );
    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(row.textContent).toContain('workflow script exited 1');
  });
});

describe('WorkflowRunPanel — stopped run (AC 18)', () => {
  it('renders hollow-ring unknown rows, a "before the run stopped" note, and a banner naming the count', () => {
    render(
      <WorkflowRunPanel
        run={run({
          status: 'stopped',
          terminalAt: 200_000,
          phases: [phase({ index: 0 })],
          agents: [
            agent({ agentId: 'a-1', state: 'progress', lastProgressAt: 190_000 }),
            agent({ agentId: 'a-2', state: 'done' }),
          ],
        })}
      />,
    );
    const staleRow = screen.getByTestId('chat-workflow-agent-a-1');
    expect(staleRow.textContent).toContain('before the run stopped');
    // Neutralized rows render a hollow ring — border-muted-foreground, per Task 37's contract.
    expect(staleRow.querySelector('.border-muted-foreground')).not.toBeNull();

    const banner = screen.getByTestId('chat-workflow-stale-banner-run_1');
    expect(banner.textContent).toContain('1');
  });
});

describe('WorkflowRunPanel — completed/failed run with an unreadable record (AC 16, A9)', () => {
  it('a completed run with lingering progress agents neutralizes them with no banner and no pulsing dot', () => {
    render(
      <WorkflowRunPanel
        run={run({
          status: 'completed',
          terminalAt: 200_000,
          phases: [phase({ index: 0 })],
          agents: [agent({ agentId: 'a-1', state: 'progress', lastProgressAt: 190_000 })],
        })}
      />,
    );
    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(row.textContent).toContain('before the run ended');
    expect(row.querySelector('.border-muted-foreground')).not.toBeNull();
    expect(row.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('chat-workflow-stale-banner-run_1')).not.toBeInTheDocument();
  });

  it('a failed run with lingering progress agents neutralizes them the same way, with no banner', () => {
    render(
      <WorkflowRunPanel
        run={run({
          status: 'failed',
          terminalAt: 200_000,
          phases: [phase({ index: 0 })],
          agents: [agent({ agentId: 'a-1', state: 'progress', lastProgressAt: 190_000 })],
        })}
      />,
    );
    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(row.textContent).toContain('before the run ended');
    expect(screen.queryByTestId('chat-workflow-stale-banner-run_1')).not.toBeInTheDocument();
  });
});

describe('WorkflowRunPanel — unavailable run (AC 19)', () => {
  it('renders "Run details unavailable", one explanatory line and the run id, with no phases/agents/counters', () => {
    render(<WorkflowRunPanel run={run({ status: 'unavailable', phases: [], agents: [] })} />);
    const panel = screen.getByTestId('chat-workflow-panel-run_1');
    expect(panel.textContent).toContain('Run details unavailable');
    expect(panel.textContent).toContain('run_1');
    expect(screen.queryByTestId('chat-workflow-phase-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^chat-workflow-agent-/)).not.toBeInTheDocument();
  });
});

describe('WorkflowRunPanel — empty edge cases', () => {
  it('a run with no phases and no agents renders without error', () => {
    render(<WorkflowRunPanel run={run({ phases: [], agents: [] })} />);
    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
  });
});
