/**
 * Tests for SchedulePillCard variants:
 *   ScheduleWakeupCard, CronCreateCard, CronDeleteCard, CronListCard, MonitorCard.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleWakeupCard, CronCreateCard, CronDeleteCard, CronListCard, MonitorCard } from '../SchedulePillCard';
import { nestedVerticalScrollers } from './_part-fixture';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };
const runningStatus: ToolCallMessagePartStatus = { type: 'running' };

type CardProps = {
  args?: ToolCallMessagePartProps['args'];
  result?: unknown;
  isError?: boolean;
  status?: ToolCallMessagePartStatus;
};

function renderWakeup(overrides: CardProps = {}) {
  const props = {
    type: 'tool-call' as const,
    toolName: 'ScheduleWakeup',
    toolCallId: 'wakeup-1',
    args: { delaySeconds: 120, reason: 'wait for build', prompt: 'check if done' },
    argsText: '',
    result: 'ok',
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <ScheduleWakeupCard {...props} />
    </TooltipProvider>,
  );
}

function renderCronCreate(overrides: CardProps = {}) {
  const resultJson = JSON.stringify({ humanSchedule: 'every day at 9am', recurring: true, durable: true });
  const props = {
    type: 'tool-call' as const,
    toolName: 'CronCreate',
    toolCallId: 'cron-1',
    args: { cron: '0 9 * * *', prompt: 'run daily check' },
    argsText: '',
    result: resultJson,
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <CronCreateCard {...props} />
    </TooltipProvider>,
  );
}

function renderCronDelete(overrides: CardProps = {}) {
  const props = {
    type: 'tool-call' as const,
    toolName: 'CronDelete',
    toolCallId: 'del-1',
    args: { id: 'job-abc-123' },
    argsText: '',
    result: 'deleted',
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <CronDeleteCard {...props} />
    </TooltipProvider>,
  );
}

function renderCronList(overrides: CardProps = {}) {
  const jobs = [
    { id: 'job-1', humanSchedule: 'every hour', recurring: true, durable: true },
    { id: 'job-2', humanSchedule: 'every day', recurring: false, durable: false },
  ];
  const props = {
    type: 'tool-call' as const,
    toolName: 'CronList',
    toolCallId: 'list-1',
    args: {},
    argsText: '',
    result: JSON.stringify(jobs),
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <CronListCard {...props} />
    </TooltipProvider>,
  );
}

function renderMonitor(overrides: CardProps = {}) {
  const props = {
    type: 'tool-call' as const,
    toolName: 'Monitor',
    toolCallId: 'mon-1',
    args: { description: 'watch build output' },
    argsText: '',
    result: 'build passed',
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <MonitorCard {...props} />
    </TooltipProvider>,
  );
}

// ── ScheduleWakeupCard ────────────────────────────────────────────────────────

describe('ScheduleWakeupCard — done state', () => {
  it('renders "Will resume in 2m" for delaySeconds=120', () => {
    renderWakeup();
    const pill = screen.getByTestId('chat-schedule-schedulewakeup-pill');
    expect(pill).toHaveTextContent('Will resume in');
    expect(pill).toHaveTextContent('2m');
  });

  it('renders the reason after the delay', () => {
    renderWakeup();
    const pill = screen.getByTestId('chat-schedule-schedulewakeup-pill');
    expect(pill).toHaveTextContent('wait for build');
  });

  it('formats 90 seconds as "1m 30s"', () => {
    renderWakeup({ args: { delaySeconds: 90, reason: '', prompt: '' } });
    const pill = screen.getByTestId('chat-schedule-schedulewakeup-pill');
    expect(pill).toHaveTextContent('1m 30s');
  });

  it('formats 45 seconds as "45s"', () => {
    renderWakeup({ args: { delaySeconds: 45, reason: '', prompt: '' } });
    const pill = screen.getByTestId('chat-schedule-schedulewakeup-pill');
    expect(pill).toHaveTextContent('45s');
  });

  it('renders "Scheduling wakeup…" in pending state', () => {
    renderWakeup({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-schedule-schedulewakeup-pill')).toHaveTextContent('Scheduling wakeup…');
  });

  it('renders "Failed: ScheduleWakeup" in error state', () => {
    renderWakeup({ result: 'err', isError: true });
    expect(screen.getByTestId('chat-schedule-schedulewakeup-pill')).toHaveTextContent('Failed: ScheduleWakeup');
  });

  it('pill is disabled in pending state', () => {
    renderWakeup({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-schedule-schedulewakeup-pill')).toBeDisabled();
  });
});

// ── CronCreateCard ────────────────────────────────────────────────────────────

describe('CronCreateCard — done state', () => {
  it('renders "Scheduled:" with humanSchedule from result JSON', () => {
    renderCronCreate();
    const pill = screen.getByTestId('chat-schedule-croncreate-pill');
    expect(pill).toHaveTextContent('Scheduled:');
    expect(pill).toHaveTextContent('every day at 9am');
  });

  it('renders "recurring" when recurring=true', () => {
    renderCronCreate();
    expect(screen.getByTestId('chat-schedule-croncreate-pill')).toHaveTextContent('recurring');
  });

  it('renders "one-shot" when recurring=false', () => {
    const result = JSON.stringify({ humanSchedule: 'once at noon', recurring: false, durable: true });
    renderCronCreate({ result });
    expect(screen.getByTestId('chat-schedule-croncreate-pill')).toHaveTextContent('one-shot');
  });

  it('renders "session-only" when durable=false', () => {
    const result = JSON.stringify({ humanSchedule: 'now', recurring: false, durable: false });
    renderCronCreate({ result });
    expect(screen.getByTestId('chat-schedule-croncreate-pill')).toHaveTextContent('session-only');
  });

  it('does NOT render "session-only" when durable=true', () => {
    renderCronCreate();
    expect(screen.getByTestId('chat-schedule-croncreate-pill')).not.toHaveTextContent('session-only');
  });

  it('renders "Creating schedule…" in pending state', () => {
    renderCronCreate({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-schedule-croncreate-pill')).toHaveTextContent('Creating schedule…');
  });
});

// ── CronDeleteCard ────────────────────────────────────────────────────────────

describe('CronDeleteCard — done state', () => {
  it('renders "Removed schedule" with the job id', () => {
    renderCronDelete();
    const pill = screen.getByTestId('chat-schedule-crondelete-pill');
    expect(pill).toHaveTextContent('Removed schedule');
    expect(pill).toHaveTextContent('job-abc-123');
  });

  it('renders "Removing schedule…" in pending state', () => {
    renderCronDelete({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-schedule-crondelete-pill')).toHaveTextContent('Removing schedule…');
  });

  it('renders error state', () => {
    renderCronDelete({ result: 'fail', isError: true });
    expect(screen.getByTestId('chat-schedule-crondelete-pill')).toHaveTextContent('Failed: CronDelete');
  });
});

// ── CronListCard ──────────────────────────────────────────────────────────────

describe('CronListCard — done state', () => {
  it('renders "Listed 2 scheduled jobs" for a 2-job result', () => {
    renderCronList();
    const pill = screen.getByTestId('chat-schedule-cronlist-pill');
    expect(pill).toHaveTextContent('Listed');
    expect(pill).toHaveTextContent('2');
    expect(pill).toHaveTextContent('scheduled jobs');
  });

  it('uses singular "job" when there is exactly 1 job', () => {
    const oneJob = JSON.stringify([{ id: 'j1', humanSchedule: 'hourly', recurring: true }]);
    renderCronList({ result: oneJob });
    const pill = screen.getByTestId('chat-schedule-cronlist-pill');
    expect(pill).toHaveTextContent('1');
    expect(pill).toHaveTextContent('scheduled job');
    expect(pill).not.toHaveTextContent('scheduled jobs');
  });

  it('is expandable — clicking shows job details', () => {
    renderCronList();
    const pill = screen.getByTestId('chat-schedule-cronlist-pill');
    expect(screen.queryByText('job-1')).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByText('job-1')).toBeInTheDocument();
    expect(screen.getByText('job-2')).toBeInTheDocument();
  });

  it('does not nest a vertical scroll container in the expanded job list (single overflow owner)', () => {
    const { container } = renderCronList();
    fireEvent.click(screen.getByTestId('chat-schedule-cronlist-pill'));
    expect(nestedVerticalScrollers(container)).toHaveLength(0);
  });

  it('renders "Listing schedules…" in pending state', () => {
    renderCronList({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-schedule-cronlist-pill')).toHaveTextContent('Listing schedules…');
  });

  it('renders 0 scheduled jobs when result is empty array', () => {
    renderCronList({ result: '[]' });
    const pill = screen.getByTestId('chat-schedule-cronlist-pill');
    expect(pill).toHaveTextContent('0');
  });
});

// ── MonitorCard ───────────────────────────────────────────────────────────────

describe('MonitorCard — done state', () => {
  it('renders "Stopped monitoring:" with the description', () => {
    renderMonitor();
    const pill = screen.getByTestId('chat-schedule-monitor-pill');
    expect(pill).toHaveTextContent('Stopped monitoring:');
    expect(pill).toHaveTextContent('watch build output');
  });

  it('is expandable — clicking shows result text', () => {
    renderMonitor();
    const pill = screen.getByTestId('chat-schedule-monitor-pill');
    expect(screen.queryByText('build passed')).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByText('build passed')).toBeInTheDocument();
  });

  it('renders "Monitoring: <description>" in pending state', () => {
    renderMonitor({ result: undefined, status: runningStatus });
    const pill = screen.getByTestId('chat-schedule-monitor-pill');
    expect(pill).toHaveTextContent('Monitoring:');
    expect(pill).toHaveTextContent('watch build output');
  });

  it('renders error state', () => {
    renderMonitor({ result: 'fail', isError: true });
    expect(screen.getByTestId('chat-schedule-monitor-pill')).toHaveTextContent('Failed: Monitor');
  });
});
