import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { ReadFileCard } from '../ReadFileCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

describe('ReadFileCard (U4 unified)', () => {
  it('renders FileTypeIcon (not Eye) and "Read" label', () => {
    const { container, getByText } = render(
      wrap(<ReadFileCard args={{ file_path: '/x/foo.ts' }} result={{ content: 'hello' }} isError={false} />),
    );
    expect(container.querySelector('svg.lucide-eye')).toBeNull();
    expect(getByText('Read')).toBeTruthy();
  });

  it('does not render Maximize2 toggle', () => {
    const { container } = render(
      wrap(<ReadFileCard args={{ file_path: '/x/foo.ts' }} result={{ content: 'hi' }} isError={false} />),
    );
    expect(container.querySelector('svg.lucide-maximize-2')).toBeNull();
  });

  it('renders ToolResultExpand for a truncated result when chatId/toolCallId present', () => {
    const { container, getByRole, getByText } = render(
      wrap(
        <ReadFileCard
          args={{ file_path: '/x/big.ts' }}
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
