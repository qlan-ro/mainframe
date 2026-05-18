import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { BashCard } from '../BashCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('BashCard (U1 unified)', () => {
  it('does not render the Maximize2 toggle icon', () => {
    const { container } = render(wrap(<BashCard args={{ command: 'ls' }} result={undefined} isError={false} />));
    expect(container.querySelector('svg.lucide-maximize-2, svg[class*="maximize"]')).toBeNull();
  });

  it('renders subHeader description when present', () => {
    const { getByText } = render(
      wrap(<BashCard args={{ command: 'ls', description: 'list files' }} result={undefined} isError={false} />),
    );
    expect(getByText('list files')).toBeTruthy();
  });

  it('renders ToolResultExpand for a truncated result when chatId/toolCallId present', () => {
    const { container, getByRole, getByText } = render(
      wrap(
        <BashCard
          args={{ command: 'cat big.log' }}
          result={{ content: 'HEAD…[truncated 9 lines · 50 KB — expand]…TAIL', truncated: true, fullBytes: 51200 }}
          isError={false}
          chatId="c1"
          toolCallId="toolu_1"
        />,
      ),
    );
    fireEvent.click(container.querySelector('[data-testid="tool-card"] button')!);
    expect(getByRole('button', { name: /show full output/i })).toBeTruthy();
    expect(getByText(/HEAD…\[truncated 9 lines · 50 KB — expand\]…TAIL/)).toBeTruthy();
  });
});
