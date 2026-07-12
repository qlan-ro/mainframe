/**
 * RunRepeatGroup — a Repeat block's fan-out children, grouped by iteration
 * (contract §2's `<innerStepId>#<iteration>` stepRef), each rendered as a
 * nested, non-spine RunStepRow. TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AutomationStep, AutomationTimelineEntry, RepeatBlock } from '../../contract';
import { RunRepeatGroup } from '../RunRepeatGroup';

const REPEAT_STEP: RepeatBlock = {
  id: 'repeat-prs',
  kind: 'repeat',
  items: { stepId: 'list-open-prs', output: 'prs' },
  steps: [{ id: 'ask-review-pr', kind: 'ask_agent', prompt: [] } satisfies AutomationStep],
};

function entry(overrides: Partial<AutomationTimelineEntry>): AutomationTimelineEntry {
  return { stepRef: 's1', stepId: 's1', kind: 'ask_agent', status: 'succeeded', ...overrides };
}

function baseProps(timeline: AutomationTimelineEntry[]) {
  return {
    repeatStep: REPEAT_STEP,
    timeline,
    steps: [REPEAT_STEP],
    catalog: [],
    interactions: [],
    onOpenChat: vi.fn(),
    onInteractionSubmitted: vi.fn(),
  };
}

describe('RunRepeatGroup', () => {
  it('renders a placeholder when no iterations have run yet', () => {
    render(<RunRepeatGroup {...baseProps([])} />);
    expect(screen.getByTestId('automations-run-repeat-repeat-prs')).toHaveTextContent(/no iterations/i);
  });

  it('groups fan-out entries into one child row per iteration, in ascending order', () => {
    const timeline = [
      entry({ stepRef: 'ask-review-pr#2', stepId: 'ask-review-pr', status: 'running' }),
      entry({ stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', status: 'succeeded' }),
    ];
    render(<RunRepeatGroup {...baseProps(timeline)} />);
    const iterations = screen.getAllByTestId(/automations-run-repeat-repeat-prs-iteration-\d/);
    expect(iterations.map((el) => el.dataset.testid)).toEqual([
      'automations-run-repeat-repeat-prs-iteration-1',
      'automations-run-repeat-repeat-prs-iteration-2',
    ]);
  });

  it('renders each iteration entry as its own nested step row', () => {
    const timeline = [
      entry({ stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', status: 'succeeded' }),
      entry({ stepRef: 'ask-review-pr#2', stepId: 'ask-review-pr', status: 'failed', error: 'rate limited' }),
    ];
    render(<RunRepeatGroup {...baseProps(timeline)} />);
    expect(screen.getByTestId('automations-run-step-ask-review-pr#1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#2')).toBeInTheDocument();
    // #2 failed, so its disclosure auto-opens and its error is visible without extra interaction.
    expect(screen.getByTestId('automations-run-step-ask-review-pr#2-error')).toHaveTextContent('rate limited');
  });

  it('ignores unrelated top-level timeline entries (e.g. the repeat block’s own entry)', () => {
    const timeline = [
      entry({ stepRef: 'repeat-prs', stepId: 'repeat-prs', kind: 'repeat', status: 'running' }),
      entry({ stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', status: 'succeeded' }),
    ];
    render(<RunRepeatGroup {...baseProps(timeline)} />);
    expect(screen.queryByTestId('automations-run-step-repeat-prs')).not.toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#1')).toBeInTheDocument();
  });
});
