/**
 * Behavior tests for ToolGroupTrigger typography/state (design parity area 5).
 *
 * Design contract (09-toolcards.jsx:172-182):
 *  - Leading chevron (11px), then an uppercase 11px/700 title with
 *    letter-spacing, then a separate mono 10px muted "N calls" segment.
 *  - No running/active loader or shimmer on the ToolGroup header — that
 *    affordance is reserved for ThinkingBlock.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '../tool-group';

function renderGroup(props: Partial<React.ComponentProps<typeof ToolGroupTrigger>> = {}) {
  return render(
    <ToolGroupRoot defaultOpen>
      <ToolGroupTrigger count={3} {...props} />
      <ToolGroupContent>body</ToolGroupContent>
    </ToolGroupRoot>,
  );
}

describe('ToolGroupTrigger — typography', () => {
  it('renders the label in an uppercase, bold, letter-spaced title segment', () => {
    renderGroup({ label: 'Read 3 files' });
    const label = screen.getByTestId('tool-group-trigger-label');
    expect(label).toHaveClass('uppercase');
    expect(label).toHaveClass('font-bold');
  });

  it('renders a separate mono call-count segment alongside the title', () => {
    renderGroup({ count: 3 });
    expect(screen.getByTestId('tool-group-trigger-count')).toHaveTextContent('3 calls');
  });
});

describe('ToolGroupTrigger — no running loader/shimmer (reserved for ThinkingBlock)', () => {
  it('does not render a loader icon when active', () => {
    const { container } = renderGroup({ active: true });
    expect(container.querySelector('[data-slot="tool-group-trigger-loader"]')).not.toBeInTheDocument();
  });

  it('does not render a shimmer overlay when active', () => {
    const { container } = renderGroup({ active: true });
    expect(container.querySelector('[data-slot="tool-group-trigger-shimmer"]')).not.toBeInTheDocument();
  });
});
