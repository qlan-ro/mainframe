/**
 * Behavior tests for WorkflowRunPanel — the run detail panel (AC 7-11, 16, 18, 19).
 * Fixed run fixtures, hardcoded expected DOM — nothing here recomputes the panel's
 * own neutralization, chip or timeline logic.
 *
 * DOM contract pinned by these tests (documented once here, not re-derived):
 *  - Header: the workflow name, a status pill (`chat-workflow-status-pill`), a
 *    segmented rail (`chat-workflow-rail`, one `data-status` segment per seeded
 *    phase), the current-phase line, and one meta span reading
 *    "<done>/<total> · <tokens> · <duration>". The old agent-count summary line is
 *    gone whenever the run has phases.
 *  - Timeline: only phases up to the deepest agent-bearing one render as
 *    `chat-workflow-phase-<index>` sections (each with a
 *    `chat-workflow-phase-toggle-<index>` button). The trailing tail collapses into
 *    one `chat-workflow-upnext` row reading "Up next · <titles>" plus its count —
 *    no phase says "not started" any more. A phase opens itself only while running
 *    or failed; anything else expands on click.
 *  - Agent rows: `chat-workflow-agent-<agentId>` keeps its `data-state` and `title`.
 *    Its detail is a disclosure — stale and error notes open themselves into
 *    `chat-workflow-agent-note-<agentId>`, result and tool notes wait for a click on
 *    `chat-workflow-agent-toggle-<agentId>`. Status is a pip carrying `data-status`;
 *    a neutralized agent reads `unknown` and nothing in its row pulses.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('shows the workflow name, the status pill and one done/total · tokens · duration meta line', () => {
    render(
      <WorkflowRunPanel
        run={run({
          status: 'completed',
          totalTokens: 500,
          durationMs: 90_000,
          phases: [phase({ index: 0, title: 'Plan' }), phase({ index: 1, title: 'Build' })],
          agents: [agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' })],
        })}
      />,
    );
    const panel = screen.getByTestId('chat-workflow-panel-run_1');
    expect(panel.textContent).toContain('deploy');
    expect(screen.getByTestId('chat-workflow-status-pill').textContent).toContain('Completed');
    expect(panel.textContent).toContain('1/2 · 500 tok · 1m');
    expect(panel.textContent).toContain('All phases complete');
    // The old agent-count summary is gone once a run has phases to count instead.
    expect(panel.textContent).not.toContain('1 of 1 done');
  });

  it('charts one rail segment per seeded phase, each carrying its status', () => {
    render(
      <WorkflowRunPanel
        run={run({
          status: 'running',
          phases: [phase({ index: 0, title: 'Plan' }), phase({ index: 1, title: 'Build' }), phase({ index: 2 })],
          agents: [
            agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
            agent({ agentId: 'a-2', phaseIndex: 1, state: 'progress' }),
          ],
        })}
      />,
    );
    const segments = screen.getByTestId('chat-workflow-rail').querySelectorAll('[data-status]');
    expect([...segments].map((segment) => segment.getAttribute('data-status'))).toEqual(['done', 'running', 'pending']);
  });
});

describe('WorkflowRunPanel — phases (AC 9)', () => {
  const reached = run({
    phases: [
      phase({ index: 0, title: 'Plan' }),
      phase({ index: 1, title: 'Build' }),
      phase({ index: 2, title: 'Review' }),
      phase({ index: 3, title: 'QA' }),
    ],
    agents: [
      agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
      agent({ agentId: 'a-2', phaseIndex: 1, state: 'progress' }),
    ],
  });

  it('renders phases up to the deepest agent-bearing one, in index order, and no further', () => {
    render(<WorkflowRunPanel run={reached} />);
    expect(screen.getByTestId('chat-workflow-phase-0').textContent).toContain('Plan');
    expect(screen.getByTestId('chat-workflow-phase-1').textContent).toContain('Build');
    expect(screen.getByTestId('chat-workflow-phase-toggle-0')).toBeInTheDocument();
    expect(screen.getByTestId('chat-workflow-phase-toggle-1')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-phase-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-workflow-phase-3')).not.toBeInTheDocument();
  });

  it('collapses the phases nothing has reached into one "Up next" row naming them', () => {
    render(<WorkflowRunPanel run={reached} />);
    const upNext = screen.getByTestId('chat-workflow-upnext');
    expect(upNext.textContent).toContain('Up next · Review, QA');
    expect(screen.getByTestId('chat-workflow-upnext-toggle').textContent).toContain('2');
    expect(screen.getByTestId('chat-workflow-panel-run_1').textContent).not.toContain('not started');
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

  it('keeps a result note behind the chevron until the row is clicked', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0 })],
          agents: [agent({ agentId: 'a-1', state: 'done', resultPreview: 'Reviewed 3 files, no issues found' })],
        })}
      />,
    );
    expect(screen.queryByTestId('chat-workflow-agent-note-a-1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('chat-workflow-agent-toggle-a-1'));

    expect(screen.getByTestId('chat-workflow-agent-note-a-1').textContent).toBe('Reviewed 3 files, no issues found');
  });
});

describe('WorkflowRunPanel — error-state agent (AC 11)', () => {
  it("opens the agent's error text by itself as the single note", () => {
    render(
      <WorkflowRunPanel
        run={run({
          phases: [phase({ index: 0 })],
          agents: [agent({ agentId: 'a-1', state: 'error', error: 'workflow script exited 1' })],
        })}
      />,
    );
    expect(screen.getByTestId('chat-workflow-agent-note-a-1').textContent).toBe('workflow script exited 1');
    expect(screen.getByTestId('chat-workflow-agent-a-1')).toHaveAttribute('data-state', 'error');
  });
});

describe('WorkflowRunPanel — stopped run (AC 18)', () => {
  it('opens a "before the run stopped" note on a hollow unknown row, under a banner naming the count', async () => {
    const user = userEvent.setup();
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
    const banner = screen.getByTestId('chat-workflow-stale-banner-run_1');
    expect(banner.textContent).toContain('1');
    // A phase that is neither running nor failed keeps its steps folded away.
    expect(screen.queryByTestId('chat-workflow-agent-a-1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('chat-workflow-phase-toggle-0'));

    const staleRow = screen.getByTestId('chat-workflow-agent-a-1');
    expect(staleRow).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByTestId('chat-workflow-agent-note-a-1').textContent).toBe(
      'Last observed 10s before the run stopped',
    );
    // Neutralized rows carry the hollow pip — the shared shape language's `unknown`.
    expect(staleRow.querySelector('[data-status]')).toHaveAttribute('data-status', 'unknown');
  });
});

describe('WorkflowRunPanel — completed/failed run with an unreadable record (AC 16, A9)', () => {
  it('a completed run with lingering progress agents neutralizes them with no banner and no pulsing pip', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByTestId('chat-workflow-phase-toggle-0'));

    const row = screen.getByTestId('chat-workflow-agent-a-1');
    expect(screen.getByTestId('chat-workflow-agent-note-a-1').textContent).toBe(
      'Last observed 10s before the run ended',
    );
    expect(row.querySelector('[data-status]')).toHaveAttribute('data-status', 'unknown');
    expect(row.querySelector('[class*="animate-pulse"]')).toBeNull();
    expect(screen.queryByTestId('chat-workflow-stale-banner-run_1')).not.toBeInTheDocument();
  });

  it('a failed run with lingering progress agents neutralizes them the same way, with no banner', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByTestId('chat-workflow-phase-toggle-0'));

    expect(screen.getByTestId('chat-workflow-agent-a-1')).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByTestId('chat-workflow-agent-note-a-1').textContent).toBe(
      'Last observed 10s before the run ended',
    );
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
