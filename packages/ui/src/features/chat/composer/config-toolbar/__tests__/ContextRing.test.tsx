import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { publishCommands } from '../../../commands/command-registry';

const append = vi.fn();
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ thread: { append } }) }));

let mockPercent: number | null = null;
vi.mock('@/features/session-panel/use-context-percent', () => ({ useContextPercent: () => mockPercent }));

let mockUsage: { totalTokens: number; maxTokens: number } | undefined;
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { contextUsage: mockUsage } }),
}));

import { ContextRing } from '../ContextRing';

const renderRing = () =>
  render(
    <TooltipProvider>
      <ContextRing />
    </TooltipProvider>,
  );
const button = () => screen.getByTestId('composer-context-percent');

beforeEach(() => {
  vi.clearAllMocks();
  mockPercent = 40;
  mockUsage = undefined;
  publishCommands([{ name: 'compact', description: 'Compact', source: 'claude' }]);
});

describe('ContextRing (C2)', () => {
  it('renders nothing before there is a usage report', () => {
    mockPercent = null;

    const { container } = renderRing();

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the percentage, and the token counts in its name when known', () => {
    mockPercent = 40;
    mockUsage = { totalTokens: 80_000, maxTokens: 200_000 };

    renderRing();

    expect(button()).toHaveTextContent('40%');
    expect(button()).toHaveAttribute('aria-label', 'Context 40% used · 80K of 200K tokens');
  });

  it('is muted at 79%', () => {
    mockPercent = 79;
    renderRing();

    expect(button()).toHaveClass('text-muted-foreground');
    expect(button()).not.toHaveClass('text-warning');
  });

  it('turns to warning ink at 80%', () => {
    mockPercent = 80;
    renderRing();

    expect(button()).toHaveClass('text-warning');
    expect(button()).not.toHaveClass('text-muted-foreground');
  });

  it('stays warning at 94%, and is signal red at 95%', () => {
    mockPercent = 94;
    const { unmount } = renderRing();
    expect(button()).toHaveClass('text-warning');
    unmount();

    mockPercent = 95;
    renderRing();
    expect(button()).toHaveClass('text-crit');
    expect(button()).not.toHaveClass('text-warning');
  });

  it('only explains itself below 95%: no menu', () => {
    mockPercent = 94;
    renderRing();

    fireEvent.pointerDown(button(), { button: 0 });

    expect(screen.queryByTestId('composer-context-compact')).toBeNull();
    expect(button()).not.toHaveAttribute('aria-haspopup');
  });

  it('opens "Compact conversation" at 95% and sends /compact', async () => {
    mockPercent = 95;
    renderRing();
    expect(button()).toHaveAttribute('aria-label', 'Context 95% used. Compact conversation');

    fireEvent.pointerDown(button(), { button: 0 });
    fireEvent.click(await screen.findByTestId('composer-context-compact'));

    expect(append).toHaveBeenCalledExactlyOnceWith({ role: 'user', content: [{ type: 'text', text: '/compact' }] });
  });

  it('disables compact, and says why, for an agent with no compact command', async () => {
    publishCommands([]);
    mockPercent = 97;
    renderRing();

    fireEvent.pointerDown(button(), { button: 0 });
    const item = await screen.findByTestId('composer-context-compact');

    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('This agent has no compact command');
  });
});
