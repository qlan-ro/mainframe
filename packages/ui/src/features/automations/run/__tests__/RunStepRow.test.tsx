/**
 * RunStepRow — one timeline row: verb icon, resolved label, duration,
 * Kept-going badge, output/error/chat disclosures, and (for a `repeat`
 * entry) its nested fan-out via RunRepeatGroup (ts153 wf2-runtime.jsx
 * `WfRunStep`, ported onto the real `AutomationTimelineEntry` — no `title`/
 * `continued`/`chat: true` on the wire, so the label/kept-going/chat
 * affordances are all derived instead of read straight off the entry).
 * TDD: test written first, implemented after.
 */
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ActionCatalogEntry,
  AutomationInteractionSummary,
  AutomationStep,
  AutomationTimelineEntry,
} from '../../contract';
import { RunStepRow } from '../RunStepRow';

const CATALOG: ActionCatalogEntry[] = [];

function entry(overrides: Partial<AutomationTimelineEntry>): AutomationTimelineEntry {
  return { stepRef: 's1', stepId: 's1', kind: 'ask_agent', status: 'succeeded', ...overrides };
}

function baseProps(overrides: Partial<ComponentProps<typeof RunStepRow>> = {}) {
  return {
    entry: entry({}),
    timeline: [] as AutomationTimelineEntry[],
    steps: [] as AutomationStep[],
    catalog: CATALOG,
    interactions: [] as AutomationInteractionSummary[],
    onOpenChat: vi.fn(),
    onInteractionSubmitted: vi.fn(),
    isLast: false,
    ...overrides,
  };
}

describe('RunStepRow — label', () => {
  it('resolves the label from the matching step definition', () => {
    const steps: AutomationStep[] = [{ id: 's1', kind: 'ask_me', title: 'Health check-in', fields: [] }];
    render(<RunStepRow {...baseProps({ entry: entry({ kind: 'ask_me' }), steps })} />);
    expect(screen.getByText('Health check-in')).toBeInTheDocument();
  });

  it('falls back to the verb label when the step definition is missing', () => {
    render(<RunStepRow {...baseProps({ entry: entry({ kind: 'notify' }), steps: [] })} />);
    expect(screen.getByText('Notify me')).toBeInTheDocument();
  });
});

describe('RunStepRow — duration', () => {
  it('shows a formatted duration when both timestamps are present', () => {
    render(<RunStepRow {...baseProps({ entry: entry({ startedAt: 0, finishedAt: 600 }) })} />);
    expect(screen.getByText('0.6s')).toBeInTheDocument();
  });

  it('shows no duration while still running (no finishedAt)', () => {
    render(<RunStepRow {...baseProps({ entry: entry({ status: 'running', startedAt: 0 }) })} />);
    expect(screen.queryByText(/s$/)).not.toBeInTheDocument();
  });
});

describe('RunStepRow — kept going', () => {
  it('shows "Kept going" for a failed step whose definition has keepGoing: true', () => {
    const steps: AutomationStep[] = [{ id: 's1', kind: 'notify', message: [], keepGoing: true }];
    render(<RunStepRow {...baseProps({ entry: entry({ kind: 'notify', status: 'failed' }), steps })} />);
    expect(screen.getByTestId('automations-run-step-s1-kept-going')).toHaveTextContent('Kept going');
  });

  it('hides the badge for a failed step without keepGoing', () => {
    const steps: AutomationStep[] = [{ id: 's1', kind: 'notify', message: [] }];
    render(<RunStepRow {...baseProps({ entry: entry({ kind: 'notify', status: 'failed' }), steps })} />);
    expect(screen.queryByTestId('automations-run-step-s1-kept-going')).not.toBeInTheDocument();
  });
});

describe('RunStepRow — disclosure', () => {
  it('auto-opens for a failed step and shows its error', () => {
    render(<RunStepRow {...baseProps({ entry: entry({ status: 'failed', error: 'boom' }) })} />);
    expect(screen.getByTestId('automations-run-step-s1-error')).toHaveTextContent('boom');
  });

  it('stays closed by default for a succeeded step, and the toggle opens it', async () => {
    const user = userEvent.setup();
    render(<RunStepRow {...baseProps({ entry: entry({ status: 'succeeded', outputPreview: 'done!' }) })} />);
    expect(screen.queryByTestId('automations-run-step-s1-output')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('automations-run-step-s1-toggle'));
    expect(screen.getByTestId('automations-run-step-s1-output')).toHaveTextContent('done!');
  });

  it('renders no toggle when there is nothing to disclose', () => {
    render(<RunStepRow {...baseProps({ entry: entry({ status: 'succeeded' }) })} />);
    expect(screen.queryByTestId('automations-run-step-s1-toggle')).not.toBeInTheDocument();
  });
});

describe('RunStepRow — agent chat', () => {
  it('shows "Open agent chat" once opened, and clicking calls onOpenChat with the chatId', async () => {
    const user = userEvent.setup();
    const onOpenChat = vi.fn();
    render(<RunStepRow {...baseProps({ entry: entry({ status: 'succeeded', chatId: 'chat-1' }), onOpenChat })} />);
    await user.click(screen.getByTestId('automations-run-step-s1-toggle'));
    await user.click(screen.getByTestId('automations-run-step-s1-chat'));
    expect(onOpenChat).toHaveBeenCalledWith('chat-1');
  });
});

describe('RunStepRow — waiting on an answer', () => {
  it('renders the inline form for a waiting step with a matching pending interaction', () => {
    const interaction: AutomationInteractionSummary = {
      id: 'ix-1',
      runId: 'run-1',
      stepRef: 's1',
      title: 'Link an ADO item?',
      fields: [],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    render(
      <RunStepRow
        {...baseProps({
          entry: entry({ status: 'waiting', interactionId: 'ix-1' }),
          interactions: [interaction],
        })}
      />,
    );
    expect(screen.getByTestId('automations-run-step-s1-form')).toBeInTheDocument();
  });
});

describe('RunStepRow — repeat fan-out', () => {
  it("renders each iteration's inner steps via RunRepeatGroup", () => {
    const repeatStep: AutomationStep = {
      id: 'repeat-prs',
      kind: 'repeat',
      items: { stepId: 'list-open-prs', output: 'prs' },
      steps: [{ id: 'ask-review-pr', kind: 'ask_agent', prompt: [] }],
    };
    const timeline: AutomationTimelineEntry[] = [
      entry({ stepRef: 'repeat-prs', stepId: 'repeat-prs', kind: 'repeat', status: 'running' }),
      entry({ stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', status: 'succeeded' }),
      entry({ stepRef: 'ask-review-pr#2', stepId: 'ask-review-pr', status: 'running' }),
    ];
    render(
      <RunStepRow
        {...baseProps({
          entry: timeline[0]!,
          timeline,
          steps: [repeatStep],
        })}
      />,
    );
    expect(screen.getByTestId('automations-run-step-ask-review-pr#1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#2')).toBeInTheDocument();
  });
});
