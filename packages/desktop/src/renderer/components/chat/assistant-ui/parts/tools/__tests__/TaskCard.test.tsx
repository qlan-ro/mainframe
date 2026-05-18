import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { TaskCard } from '../TaskCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('TaskCard (U6 unified)', () => {
  it('renders description in subheader (below header), not inline', () => {
    const { getByText } = render(
      wrap(
        <TaskCard
          args={{ subagent_type: 'general-purpose', description: 'Fix login', prompt: 'Long prompt...' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(getByText('Fix login')).toBeTruthy();
    expect(getByText('general-purpose')).toBeTruthy();
  });

  it('does not render description in header row (description is in subheader)', () => {
    const { getByTestId, getByText } = render(
      wrap(
        <TaskCard
          args={{ subagent_type: 'general-purpose', description: 'Fix login' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    const card = getByTestId('task-card');
    // description node should be a sibling of the header div, not inside it
    const headerDiv = card.firstElementChild;
    expect(headerDiv).toBeTruthy();
    // agent type is in header
    expect(headerDiv!.textContent).toContain('general-purpose');
    // description text exists in card but NOT inside the header row
    const descNode = getByText('Fix login');
    expect(headerDiv!.contains(descNode)).toBe(false);
  });

  it('shows usage stats when result is provided', () => {
    const result = '<usage>\n  total_tokens: 1500\n  tool_uses: 3\n  duration_ms: 5000\n</usage>';
    const { container } = render(
      wrap(<TaskCard args={{ subagent_type: 'general-purpose' }} result={result} isError={false} />),
    );
    expect(container.textContent).toContain('tool uses');
    expect(container.textContent).toContain('tokens');
  });

  it('falls back to prompt as description text when no description arg', () => {
    const { getByText } = render(
      wrap(
        <TaskCard
          args={{ subagent_type: 'general-purpose', prompt: 'Do the thing' }}
          result={undefined}
          isError={false}
        />,
      ),
    );
    expect(getByText('Do the thing')).toBeTruthy();
  });
});
