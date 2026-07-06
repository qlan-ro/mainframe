/**
 * Behavior tests for MessageToolGroup (tool-dispatch.tsx).
 *
 * Design contract (09-toolcards.jsx:173): explore tool-groups (grep/read/glob/ls
 * investigations) render EXPANDED on first paint — ToolGroup always
 * initializes `useState(true)`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageToolGroup } from '../tool-dispatch';

describe('MessageToolGroup — default open state', () => {
  it('renders its content expanded on first paint (open by default)', () => {
    render(
      <MessageToolGroup indices={[0, 1]} running={false} summary="Read 2 files">
        <div data-testid="tool-group-child">child content</div>
      </MessageToolGroup>,
    );

    const trigger = screen.getByTestId('chat-tool-group-toggle');
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('tool-group-child')).toBeVisible();
  });
});
