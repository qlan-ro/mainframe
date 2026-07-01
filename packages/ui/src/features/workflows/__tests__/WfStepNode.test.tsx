/**
 * WfStepNode — leaf step row with expandable I/O detail.
 *
 * TDD: tests written first, component implemented after.
 * Covers: failed error box (red), ambiguous error box + amber ring,
 * succeeded agent step with chatId expands to show output + chat button,
 * truncated output shows the truncation note.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RunTreeNode } from '@/lib/api/workflows';
import { WfStepNode } from '@/features/workflows/WfStepNode';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<RunTreeNode>): RunTreeNode {
  return {
    stepPath: 'root.step1',
    stepId: 'do-work',
    kind: 'agent',
    status: 'succeeded',
    attempt: 1,
    input: { query: 'hello' },
    output: { result: 'world' },
    error: null,
    ...overrides,
  };
}

const noop = () => {};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WfStepNode — collapsed row', () => {
  it('renders the row testid scoped to stepPath', () => {
    render(<WfStepNode node={makeNode({})} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.step1')).toBeInTheDocument();
  });

  it('shows the stepId as the row title when present', () => {
    render(<WfStepNode node={makeNode({ stepId: 'do-work' })} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.step1').textContent).toContain('do-work');
  });

  it('falls back to the kind label when stepId is null', () => {
    render(<WfStepNode node={makeNode({ stepId: null, kind: 'connector' })} onOpenChat={noop} />);
    // WfKindChip's kind=connector has label "Service"; row should show it
    expect(screen.getByTestId('workflows-step-root.step1').textContent).toContain('Service');
  });

  it('renders a WfStatusTag for the step status', () => {
    render(<WfStepNode node={makeNode({ status: 'succeeded' })} onOpenChat={noop} />);
    // WfStatusTag renders "Done" for succeeded step
    expect(screen.getByTestId('workflows-step-root.step1').textContent).toContain('Done');
  });

  it('shows an attempts badge (↻N) when attempt > 1', () => {
    render(<WfStepNode node={makeNode({ attempt: 3 })} onOpenChat={noop} />);
    expect(screen.getByTestId('workflows-step-root.step1').textContent).toContain('3');
  });

  it('does not show an attempts badge when attempt === 1', () => {
    render(<WfStepNode node={makeNode({ attempt: 1 })} onOpenChat={noop} />);
    // No retry badge rendered — the number "1" should not appear in a badge context.
    // We rely on the absence of the retry badge testid.
    expect(screen.queryByTestId('workflows-step-root.step1-retry')).not.toBeInTheDocument();
  });

  it('applies an amber inset ring/fill on ambiguous nodes', () => {
    render(<WfStepNode node={makeNode({ status: 'ambiguous' })} onOpenChat={noop} />);
    const row = screen.getByTestId('workflows-step-root.step1');
    // The row wrapper should carry a ring/warning-tint class indicating warning
    expect(row.className).toMatch(/ring|warning/i);
  });

  it('renders an on-spine status pip for the row', () => {
    render(<WfStepNode node={makeNode({ status: 'succeeded' })} onOpenChat={noop} />);
    // The pip sits absolutely on the rail spine, scoped to the step path.
    expect(screen.getByTestId('workflows-step-root.step1-pip')).toBeInTheDocument();
  });
});

describe('WfStepNode — expand/collapse', () => {
  it('detail area is hidden by default', () => {
    const node = makeNode({ output: { x: 1 }, error: null, chatId: undefined });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    // Clicking reveals content; before clicking, pre blocks are not visible
    expect(screen.queryByText(/"x"/)).not.toBeInTheDocument();
  });

  it('clicking the row expands the detail area', () => {
    const node = makeNode({ output: { x: 1 }, error: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    // Output JSON should now be visible
    expect(screen.getByText(/"x"/)).toBeInTheDocument();
  });

  it('clicking the row again collapses the detail area', () => {
    const node = makeNode({ output: { x: 1 }, error: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.queryByText(/"x"/)).not.toBeInTheDocument();
  });

  it('does not expand when there is no error, input, output, or chatId', () => {
    const node = makeNode({ input: null, output: null, error: null, chatId: undefined });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    // No detail to show — clicking should be a no-op (no expanded content rendered)
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.queryByRole('button', { name: /open agent chat/i })).not.toBeInTheDocument();
  });
});

describe('WfStepNode — failed step', () => {
  it('shows the error text in a red box when status is failed', () => {
    const node = makeNode({ status: 'failed', error: 'Task timeout after 30s', output: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.getByText('Task timeout after 30s')).toBeInTheDocument();
  });

  it('error box has destructive (red) styling for failed', () => {
    const node = makeNode({ status: 'failed', error: 'Boom', output: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    // Walk up to the box div that carries the bg/text color (the span is text-caption only)
    const errorBox = screen.getByText('Boom').closest('div');
    expect(errorBox?.className).toMatch(/destructive/);
  });
});

describe('WfStepNode — ambiguous step', () => {
  it('shows the "Outcome uncertain" headline in an amber box', () => {
    const node = makeNode({ status: 'ambiguous', error: null, output: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.getByText(/Outcome uncertain/i)).toBeInTheDocument();
  });

  it('renders the actual error text alongside the headline (does not drop it)', () => {
    const node = makeNode({
      status: 'ambiguous',
      error: 'connection reset by peer',
      output: null,
    });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    // Both the headline AND the underlying error must be visible.
    expect(screen.getByText(/Outcome uncertain/i)).toBeInTheDocument();
    expect(screen.getByText('connection reset by peer')).toBeInTheDocument();
  });

  it('amber box has the warning tint class', () => {
    const node = makeNode({ status: 'ambiguous', error: null, output: null });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    // Walk up to the box div that carries bg/text warning tokens (span is text-caption only)
    const box = screen.getByText(/Outcome uncertain/i).closest('div');
    expect(box?.className).toMatch(/warning/);
  });
});

describe('WfStepNode — succeeded agent step with chatId and output', () => {
  it('shows output in a pre block when expanded', () => {
    const node = makeNode({ status: 'succeeded', output: { result: 'done' }, chatId: 'chat-abc' });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    // The pre block should contain the JSON-formatted output
    expect(screen.getByText(/"result"/)).toBeInTheDocument();
  });

  it('renders an "Open agent chat" button with the correct testid', () => {
    const node = makeNode({ status: 'succeeded', chatId: 'chat-abc', output: { r: 1 } });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.getByTestId('workflows-step-chat-root.step1')).toBeInTheDocument();
  });

  it('calls onOpenChat with the chatId when the chat button is clicked', () => {
    const onOpenChat = vi.fn();
    const node = makeNode({ status: 'succeeded', chatId: 'chat-abc', output: { r: 1 } });
    render(<WfStepNode node={node} onOpenChat={onOpenChat} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    fireEvent.click(screen.getByTestId('workflows-step-chat-root.step1'));
    expect(onOpenChat).toHaveBeenCalledWith('chat-abc');
  });
});

describe('WfStepNode — truncated output', () => {
  it('shows "truncated for display" note when node.truncated is true', () => {
    // Both input and output show the note when truncated — use getAllByText
    const node = makeNode({ output: { big: 'data' }, truncated: true });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    const notes = screen.getAllByText(/truncated for display/i);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('does not show the truncation note when node.truncated is false', () => {
    const node = makeNode({ output: { big: 'data' }, truncated: false });
    render(<WfStepNode node={node} onOpenChat={noop} />);
    fireEvent.click(screen.getByTestId('workflows-step-root.step1'));
    expect(screen.queryByText(/truncated for display/i)).not.toBeInTheDocument();
  });
});
