import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PlanApprovedMarker } from '../PlanApprovedMarker';

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (select: (extras: unknown) => unknown) =>
    select({ state: { chatConfig: { permissionMode: 'yolo' } } }),
  useChatExtras: () => undefined,
}));

it('says how the plan is carried out and that the context was cleared, and opens on the plan', () => {
  render(
    <TooltipProvider>
      <PlanApprovedMarker plan={'# Dummy Plan\n\nSome body'} messageId="m" />
    </TooltipProvider>,
  );
  const pill = screen.getByTestId('chat-plan-approved');
  expect(pill).toHaveTextContent('Plan approved implementing with Unattended·context cleared');
  fireEvent.click(pill);
  expect(screen.getByRole('heading', { name: 'Dummy Plan' })).toBeVisible();
  expect(screen.getByText('Some body')).toBeVisible();
});
