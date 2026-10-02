import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CompactReasoningRow } from '../CompactReasoningRow';

afterEach(() => vi.useRealTimers());
it('keeps untimed history untimed and reveals reasoning text', () => {
  render(
    <TooltipProvider>
      <CompactReasoningRow memberKeys={['untimed-reasoning']} running={false}>
        Reasoning body
      </CompactReasoningRow>
    </TooltipProvider>,
  );
  const toggle = screen.getByRole('button', { name: 'Thought' });
  expect(screen.queryByTestId('chat-compact-elapsed')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText('Reasoning body')).toBeInTheDocument();
});
it('uses only explicit phase timing and leaves the button name stable across ticks', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const view = render(
    <TooltipProvider>
      <CompactReasoningRow memberKeys={['timed-reasoning']} running phaseTiming={{ startedAt: 8000 }}>
        Body
      </CompactReasoningRow>
    </TooltipProvider>,
  );
  const button = screen.getByRole('button', { name: 'Thinking' });
  expect(screen.getByText('2s')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText('4s')).toBeInTheDocument();
  expect(button).toHaveAccessibleName('Thinking');
  view.rerender(
    <TooltipProvider>
      <CompactReasoningRow
        memberKeys={['timed-reasoning']}
        running={false}
        phaseTiming={{ startedAt: 8000, completedAt: 11500 }}
      >
        Body
      </CompactReasoningRow>
    </TooltipProvider>,
  );
  expect(screen.getByRole('button', { name: 'Thought' })).toHaveTextContent('Thoughtfor 3s');
});
