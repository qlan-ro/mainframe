/**
 * WfTree — composite rail rendering.
 *
 * TDD: tests written first, component implemented after.
 * Covers:
 * - parallel node → 2 lane cards
 * - choose node → only taken arm's steps render; untaken arm dimmed + Skipped tag
 * - foreach node → iteration tabs + switching shows the right steps
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RunTreeNode } from '@/lib/api/workflows';
import { WfTree } from '@/features/workflows/WfTree';

const noop = () => {};

function leaf(stepPath: string, stepId?: string): RunTreeNode {
  return {
    stepPath,
    stepId: stepId ?? stepPath,
    kind: 'agent',
    status: 'succeeded',
    attempt: 1,
    input: null,
    output: null,
    error: null,
  };
}

// ── Rail structure ─────────────────────────────────────────────────────────────

describe('WfTree — rail structure', () => {
  it('renders a single vertical spine line (positioned at left:13)', () => {
    const { container } = render(<WfTree nodes={[leaf('root.a'), leaf('root.b')]} onOpenChat={noop} />);
    // The spine is an absolute hairline at left-[13px]; there is exactly one at
    // the top level.
    const spine = container.querySelector('.left-\\[13px\\]');
    expect(spine).toBeTruthy();
  });

  it('does NOT use border-l-2 colored bars (removed in the rail rebuild)', () => {
    const node: RunTreeNode = {
      ...leaf('root.p', 'parallel'),
      kind: 'parallel',
      status: 'running',
      lanes: [{ label: 'Lane A', status: 'succeeded', steps: [leaf('root.p.a')] }],
    };
    const { container } = render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(container.querySelector('.border-l-2')).toBeNull();
  });

  it('indents composite children past the spine (marginLeft:30)', () => {
    const node: RunTreeNode = {
      ...leaf('root.p', 'parallel'),
      kind: 'parallel',
      status: 'running',
      lanes: [{ label: 'Lane A', status: 'succeeded', steps: [leaf('root.p.a')] }],
    };
    const { container } = render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(container.querySelector('.ml-\\[30px\\]')).toBeTruthy();
  });
});

// ── Parallel (lanes) ──────────────────────────────────────────────────────────

describe('WfTree — parallel node', () => {
  it('renders a lane card for each lane', () => {
    const node: RunTreeNode = {
      stepPath: 'root.parallel',
      stepId: 'do-parallel',
      kind: 'parallel',
      status: 'running',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      lanes: [
        { label: 'Lane A', status: 'succeeded', steps: [leaf('root.parallel.a')] },
        { label: 'Lane B', status: 'running', steps: [leaf('root.parallel.b')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByText('Lane A')).toBeInTheDocument();
    expect(screen.getByText('Lane B')).toBeInTheDocument();
  });

  it('renders steps inside each lane', () => {
    const node: RunTreeNode = {
      stepPath: 'root.p',
      stepId: 'parallel',
      kind: 'parallel',
      status: 'running',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      lanes: [
        { label: 'Lane A', status: 'succeeded', steps: [leaf('root.p.a', 'step-a')] },
        { label: 'Lane B', status: 'running', steps: [leaf('root.p.b', 'step-b')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.p.a')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-step-root.p.b')).toBeInTheDocument();
  });
});

// ── Choose (arms) ─────────────────────────────────────────────────────────────

describe('WfTree — choose node', () => {
  it('renders the taken arm steps', () => {
    const node: RunTreeNode = {
      stepPath: 'root.choose',
      stepId: 'branch',
      kind: 'choose',
      status: 'succeeded',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      arms: [
        { cond: 'x > 0', taken: true, steps: [leaf('root.choose.arm0.step', 'taken-step')] },
        { cond: 'else', taken: false, steps: [leaf('root.choose.arm1.step', 'untaken-step')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.choose.arm0.step')).toBeInTheDocument();
  });

  it('does not render the steps of untaken arms', () => {
    const node: RunTreeNode = {
      stepPath: 'root.choose',
      stepId: 'branch',
      kind: 'choose',
      status: 'succeeded',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      arms: [
        { cond: 'x > 0', taken: true, steps: [leaf('root.choose.arm0.step', 'taken-step')] },
        { cond: 'else', taken: false, steps: [leaf('root.choose.arm1.step', 'untaken-step')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.queryByTestId('workflows-step-root.choose.arm1.step')).not.toBeInTheDocument();
  });

  it('renders the condition text for each arm', () => {
    const node: RunTreeNode = {
      stepPath: 'root.choose',
      stepId: 'branch',
      kind: 'choose',
      status: 'succeeded',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      arms: [
        { cond: 'x > 0', taken: true, steps: [] },
        { cond: 'else', taken: false, steps: [] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByText('x > 0')).toBeInTheDocument();
    expect(screen.getByText('else')).toBeInTheDocument();
  });
});

// ── Foreach (iterations) ──────────────────────────────────────────────────────

describe('WfTree — foreach node', () => {
  it('renders an iteration tab for each iteration', () => {
    const node: RunTreeNode = {
      stepPath: 'root.foreach',
      stepId: 'loop',
      kind: 'foreach',
      status: 'running',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      iterations: [
        { label: 'item[0]', status: 'succeeded', steps: [leaf('root.foreach.0.step', 'step-a')] },
        { label: 'item[1]', status: 'running', steps: [leaf('root.foreach.1.step', 'step-b')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-iter-item[0]')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-iter-item[1]')).toBeInTheDocument();
  });

  it('shows the selected iteration steps by default', () => {
    const node: RunTreeNode = {
      stepPath: 'root.foreach',
      stepId: 'loop',
      kind: 'foreach',
      status: 'running',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      iterations: [
        { label: 'item[0]', status: 'succeeded', steps: [leaf('root.foreach.0.step', 'step-a')] },
        { label: 'item[1]', status: 'running', steps: [leaf('root.foreach.1.step', 'step-b')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    // Default selects the first running/waiting iteration, which is index 1
    expect(screen.getByTestId('workflows-step-root.foreach.1.step')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-step-root.foreach.0.step')).not.toBeInTheDocument();
  });

  it('switching to a different iteration tab shows its steps', () => {
    const node: RunTreeNode = {
      stepPath: 'root.foreach',
      stepId: 'loop',
      kind: 'foreach',
      status: 'succeeded',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      iterations: [
        { label: 'item[0]', status: 'succeeded', steps: [leaf('root.foreach.0.step', 'step-a')] },
        { label: 'item[1]', status: 'succeeded', steps: [leaf('root.foreach.1.step', 'step-b')] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    // Both are succeeded so default is first (index 0); switch to second
    fireEvent.click(screen.getByTestId('workflows-iter-item[1]'));
    expect(screen.getByTestId('workflows-step-root.foreach.1.step')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-step-root.foreach.0.step')).not.toBeInTheDocument();
  });

  it('active succeeded iteration chip uses the success color, not amber', () => {
    const node: RunTreeNode = {
      stepPath: 'root.foreach',
      stepId: 'loop',
      kind: 'foreach',
      status: 'succeeded',
      attempt: 1,
      input: null,
      output: null,
      error: null,
      iterations: [{ label: 'item[0]', status: 'succeeded', steps: [] }],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    const chip = screen.getByTestId('workflows-iter-item[0]');
    expect(chip.className).toContain('bg-mf-success/10');
    expect(chip.className).not.toContain('bg-mf-warning/10');
  });
});

// ── Leaf passthrough ──────────────────────────────────────────────────────────

describe('WfTree — leaf step', () => {
  it('renders a leaf step as WfStepNode with the correct testid', () => {
    render(<WfTree nodes={[leaf('root.step1', 'do-work')]} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.step1')).toBeInTheDocument();
  });

  it('renders the daemon-supplied duration chip', () => {
    const node: RunTreeNode = { ...leaf('root.d', 'do'), duration: '3m 12s' };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByText('3m 12s')).toBeInTheDocument();
  });

  it('renders the daemon-supplied composite summary', () => {
    const node: RunTreeNode = {
      ...leaf('root.p', 'parallel'),
      kind: 'parallel',
      status: 'running',
      summary: '1 of 2',
      lanes: [
        { label: 'A', status: 'succeeded', steps: [] },
        { label: 'B', status: 'running', steps: [] },
      ],
    };
    render(<WfTree nodes={[node]} onOpenChat={noop} />);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('passes onOpenChat down to WfStepNode', () => {
    const onOpenChat = vi.fn();
    const node: RunTreeNode = {
      ...leaf('root.agent-step', 'agent'),
      chatId: 'chat-xyz',
      output: { x: 1 },
    };
    render(<WfTree nodes={[node]} onOpenChat={onOpenChat} />);
    // Expand the step to see the chat button
    fireEvent.click(screen.getByTestId('workflows-step-root.agent-step'));
    fireEvent.click(screen.getByTestId('workflows-step-chat-root.agent-step'));
    expect(onOpenChat).toHaveBeenCalledWith('chat-xyz');
  });
});
