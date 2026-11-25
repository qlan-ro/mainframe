import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import type { ToolPart, TurnUnit } from '../../../view-model/turn/types';
import { EventMarker } from '../EventMarker';
import { Zap } from 'lucide-react';
import { expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MarkerPill, type MarkerPillProps } from '../MarkerPill';

let pills = 0;
const show = (props: Partial<MarkerPillProps> = {}) =>
  render(
    <TooltipProvider>
      <MarkerPill
        rowKey={`pill-${++pills}`}
        testId="pill"
        icon={Zap}
        label="Used skill"
        activityId="call-1"
        {...props}
      />
    </TooltipProvider>,
  );

it('opens a card under it', () => {
  show({ children: <p>SKILL.md</p> });
  const pill = screen.getByTestId('pill');
  expect(pill).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(pill);
  expect(pill).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(pill.getAttribute('aria-controls')!)).toHaveTextContent('SKILL.md');
});

it('is not a control when it has nothing to open', () => {
  show();
  expect(screen.getByTestId('pill')).toBeDisabled();
  expect(screen.getByTestId('pill')).not.toHaveAttribute('aria-expanded');
});

it('can be found by its call, with its own disclosure first inside', () => {
  const { container } = show({ children: <p>body</p> });
  const anchor = container.querySelector('[data-activity-id="call-1"]')!;
  expect(anchor.querySelector('[aria-expanded]')).toBe(screen.getByTestId('pill'));
});

it('spins while it runs and reads failed in rose', () => {
  show({ state: 'running', receipt: '18s' });
  expect(screen.getByTestId('pill')).toHaveTextContent('Used skill·18s');
  expect(document.querySelector('.animate-spin')).not.toBeNull();
  show({ state: 'failed', testId: 'failed-pill' });
  expect(screen.getByTestId('failed-pill')).toHaveClass('text-fail');
});

const worktreePath = '/workspace/sample/.worktrees/format-cleanup';

function EnterWorktree() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: [], onNew: async () => {} });
  const part = {
    type: 'tool-call',
    toolName: 'EnterWorktree',
    toolCallId: 'enter',
    args: {},
    argsText: '',
    result: JSON.stringify({ worktreePath }),
    status: { type: 'complete' },
  } as ToolPart;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <EventMarker unit={{ key: 'enter', part } as TurnUnit} part={part} />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

it.each(['hover', 'keyboard focus'])('shows the path-only EnterWorktree tooltip on %s', async (gesture) => {
  const user = userEvent.setup();
  render(<EnterWorktree />);
  const pill = screen.getByTestId('chat-marker-enterworktree');
  expect(pill).toHaveTextContent(worktreePath);
  const trigger = pill.closest<HTMLElement>('[data-slot="tooltip-trigger"]')!;
  expect(trigger).toBeInTheDocument();
  if (gesture === 'hover') {
    await user.hover(trigger);
  } else {
    await user.tab();
    expect(trigger).toHaveFocus();
  }
  expect(await screen.findByRole('tooltip')).toHaveTextContent(worktreePath);
});
