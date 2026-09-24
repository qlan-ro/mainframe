/**
 * ActivityCard — unit tests (todo #328: stop, details, terminal retention).
 *
 * Behaviors covered:
 *  - the empty state keeps the card header and shows one muted placeholder row,
 *    with no count badge (D6)
 *  - one row per task, with its description/kind glyph and elapsed time
 *  - the count badge counts only running (and stopping) rows (AC15)
 *  - the header X closes the panel
 *  - stop: the control is present on a running row and fires exactly one stop
 *    per activation, without opening the detail view (AC1, AC2)
 *  - stop-error: the retry control carries the message and retries on click (AC3)
 *  - unsupported stop: disabled, focusable, tooltip, no call (AC7)
 *  - a terminal row shows its status word and a dismiss control, and dismissing
 *    it leaves the running badges unchanged (AC13, AC15)
 *  - drill-in: a non-workflow row opens ActivityDetail; a workflow row with a
 *    known run still opens its run panel, even when terminal (AC9)
 *  - the output tail's states, and the agent transcript note (AC10, AC22)
 *  - Monitor vs Task glyph/label (AC16)
 *  - switching chats resets the drill-in
 *
 * Mocked dependencies: `useChatExtras`, `useWorkflowRun`, `useAdapters`, and
 * the background-tasks API module (output tail).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { AdapterInfo, BackgroundActivityTask, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BackgroundStopState } from '@/features/chat/controller/background-activity-state';

let mockTasks: Record<string, BackgroundActivityTask> = {};
let mockStops: Record<string, BackgroundStopState> = {};
let mockChatId = 'chat-1';
let mockAdapterId: string | undefined = 'claude';
const stopBackgroundTask = vi.fn();
const dismissBackgroundTask = vi.fn();
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: {
      chatId: mockChatId,
      backgroundTasks: mockTasks,
      backgroundStops: mockStops,
      chatConfig: { adapterId: mockAdapterId },
    },
    stopBackgroundTask,
    dismissBackgroundTask,
  }),
}));

let mockRuns: Record<string, ClaudeWorkflowRun> = {};
vi.mock('@/features/chat/workflow/use-workflow-run', () => ({
  useWorkflowRun: (taskId: string | undefined) => (taskId ? mockRuns[taskId] : undefined),
}));

let mockAdapters: AdapterInfo[] = [];
vi.mock('@/store/adapters', () => ({
  useAdapters: () => mockAdapters,
}));

const getBackgroundTaskOutput = vi.fn();
vi.mock('@/lib/api/background-tasks', () => ({
  getBackgroundTaskOutput: (...args: unknown[]) => getBackgroundTaskOutput(...args),
}));

const { ActivityCard } = await import('../ActivityCard');

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });

function adapter(id: string, name: string, stopBackgroundTaskSupported: boolean): AdapterInfo {
  return {
    id,
    name,
    description: '',
    installed: true,
    models: [],
    capabilities: { planMode: false, autoMode: false, stopBackgroundTask: stopBackgroundTaskSupported },
  };
}

function task(id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask {
  return {
    id,
    kind: 'bash',
    description: `task ${id}`,
    startedAt: 0,
    status: 'running',
    toolName: 'Bash',
    command: `cmd ${id}`,
    ...overrides,
  };
}

function workflowTask(
  id: string,
  runId: string,
  workflowName: string,
  overrides: Partial<BackgroundActivityTask> = {},
): BackgroundActivityTask {
  return {
    id,
    kind: 'workflow',
    description: workflowName,
    startedAt: 0,
    status: 'running',
    workflowName,
    runId,
    ...overrides,
  };
}

function workflowRun(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'w-1',
    runId: 'run_1',
    workflowName: 'deploy',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [
      {
        agentId: 'a-1',
        index: 0,
        phaseIndex: 0,
        label: 'reviewer',
        state: 'progress',
        tokens: 0,
        toolCalls: 0,
        durationMs: 0,
      },
    ],
    ...overrides,
  };
}

const onClose = vi.fn();
const card = () => <ActivityCard onClose={onClose} />;
const badge = () => screen.getByTestId('session-panel-card-activity').querySelector('[data-slot="badge"]');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(10 * 60_000); // t = 10 minutes
  mockTasks = {};
  mockStops = {};
  mockChatId = 'chat-1';
  mockAdapterId = 'claude';
  mockAdapters = [adapter('claude', 'Claude', true)];
  mockRuns = {};
  getBackgroundTaskOutput.mockReset();
  getBackgroundTaskOutput.mockResolvedValue({ kind: 'none' });
  stopBackgroundTask.mockReset();
  dismissBackgroundTask.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActivityCard — empty (D6)', () => {
  it('keeps the card and shows one muted placeholder row', () => {
    render(card());
    expect(screen.getByTestId('session-panel-card-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-activity-empty')).toHaveTextContent('Nothing running');
  });

  it('shows no count badge with nothing running', () => {
    render(card());
    expect(badge()).toBeNull();
  });
});

describe('ActivityCard — card chrome', () => {
  it('titles the card Activity', () => {
    render(card());
    expect(screen.getByTestId('session-panel-card-activity')).toHaveTextContent('Activity');
  });

  it('closes the panel from the header X', () => {
    render(card());
    fireEvent.click(screen.getByTestId('session-panel-card-close-activity'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ActivityCard — task rows', () => {
  it('renders one row per live task with its description and elapsed time', () => {
    mockTasks = {
      'a-1': task('a-1', { kind: 'agent', description: 'reviewer subagent', startedAt: 5 * 60_000 }),
      'b-1': task('b-1', { description: 'pnpm dev', startedAt: 10 * 60_000 - 20_000 }),
    };
    render(card());

    expect(screen.getByTestId('session-panel-task-a-1')).toHaveTextContent('reviewer subagent');
    expect(screen.getByTestId('session-panel-task-a-1')).toHaveTextContent('5m');
    expect(screen.getByTestId('session-panel-task-b-1')).toHaveTextContent('pnpm dev');
    expect(screen.getByTestId('session-panel-task-b-1')).toHaveTextContent('<1m');
    expect(screen.queryByTestId('session-panel-activity-empty')).toBeNull();
  });

  it('counts only running work in the card badge (AC15)', () => {
    mockTasks = {
      'a-1': task('a-1', { kind: 'agent' }),
      'b-1': task('b-1'),
      'c-1': task('c-1', { status: 'completed', endedAt: 10 }),
    };
    render(card());
    expect(badge()).toHaveTextContent('2');
  });

  it('leads each row with its kind glyph — agent, task, monitor, or other (AC16)', () => {
    mockTasks = {
      'a-1': task('a-1', { kind: 'agent' }),
      'b-1': task('b-1', { toolName: 'Bash' }),
      'm-1': task('m-1', { toolName: 'Monitor' }),
      'c-1': task('c-1', { kind: 'other', reportedType: 'container_exec' }),
    };
    render(card());

    expect(within(screen.getByTestId('session-panel-task-a-1')).getByTestId('session-panel-kind-agent')).toBeVisible();
    expect(within(screen.getByTestId('session-panel-task-b-1')).getByTestId('session-panel-kind-bash')).toBeVisible();
    expect(
      within(screen.getByTestId('session-panel-task-m-1')).getByTestId('session-panel-kind-monitor'),
    ).toBeVisible();
    expect(screen.getByTestId('session-panel-task-m-1')).toHaveTextContent('Monitor');
    expect(within(screen.getByTestId('session-panel-task-c-1')).getByTestId('session-panel-kind-other')).toBeVisible();
    expect(screen.getByTestId('session-panel-task-c-1')).toHaveTextContent('container_exec');
  });

  it('every row opens its detail view — there is nothing inert anymore (AC9)', () => {
    mockTasks = { 'a-1': task('a-1', { kind: 'agent', description: 'reviewer subagent' }) };
    render(card());
    expect(screen.getByTestId('activity-drill-open-a-1').tagName).toBe('BUTTON');
  });
});

describe('ActivityCard — stop (AC1, AC2)', () => {
  it('shows the stop control on a running row and never opens detail on activation', () => {
    mockTasks = { 'a-1': task('a-1') };
    render(card());
    fireEvent.click(screen.getByTestId('activity-stop-a-1'));
    expect(stopBackgroundTask).toHaveBeenCalledTimes(1);
    expect(stopBackgroundTask).toHaveBeenCalledWith('a-1');
    expect(screen.queryByTestId('activity-detail-a-1')).toBeNull();
  });

  it('shows the stopping state — a spinner and "Stopping…" — while a stop is in flight', () => {
    mockTasks = { 'a-1': task('a-1') };
    mockStops = { 'a-1': { phase: 'stopping' } };
    render(card());
    expect(screen.getByTestId('session-panel-task-a-1')).toHaveTextContent('Stopping…');
    expect(screen.queryByTestId('activity-stop-a-1')).toBeNull();
  });
});

describe('ActivityCard — stop-error (AC3)', () => {
  it('shows the retryable error control with the message, and retries on click', () => {
    mockTasks = { 'a-1': task('a-1') };
    mockStops = { 'a-1': { phase: 'error', message: "Couldn't stop this task: boom" } };
    render(card());

    const control = screen.getByTestId('activity-stop-error-a-1');
    expect(control).toHaveAccessibleName("Couldn't stop this task: boom");

    fireEvent.click(control);
    expect(stopBackgroundTask).toHaveBeenCalledWith('a-1');
  });
});

describe('ActivityCard — unsupported stop (AC7)', () => {
  it('is disabled, focusable, tooltips the adapter name, and sends nothing', () => {
    mockAdapterId = 'codex';
    mockAdapters = [adapter('codex', 'Codex', false)];
    mockTasks = { 'a-1': task('a-1') };
    render(card());

    const control = screen.getByTestId('activity-stop-a-1');
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control.tabIndex).not.toBe(-1);

    fireEvent.click(control);
    expect(stopBackgroundTask).not.toHaveBeenCalled();
  });

  it('treats an unknown adapter as unsupported', () => {
    mockAdapterId = 'ghost';
    mockAdapters = [];
    mockTasks = { 'a-1': task('a-1') };
    render(card());
    expect(screen.getByTestId('activity-stop-a-1')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ActivityCard — terminal rows (AC13, AC15)', () => {
  it('keeps a settled row listed with its status word and duration, and dismissing it leaves the running count unchanged', () => {
    mockTasks = {
      'a-1': task('a-1', { status: 'running' }),
      'b-1': task('b-1', {
        status: 'completed',
        endedAt: 30_000,
        summary: 'done',
        usage: { totalTokens: 10, toolUses: 1, durationMs: 5000 },
      }),
    };
    render(card());

    expect(screen.getByTestId('session-panel-task-b-1')).toHaveTextContent('Completed');
    expect(badge()).toHaveTextContent('1');
    expect(screen.queryByTestId('activity-stop-b-1')).toBeNull();

    fireEvent.click(screen.getByTestId('activity-dismiss-b-1'));
    expect(dismissBackgroundTask).toHaveBeenCalledWith('b-1');
    expect(badge()).toHaveTextContent('1');
  });
});

describe('ActivityCard — detail drill-in (AC9)', () => {
  it('opens a non-workflow row into its detail view, showing status, description, command and duration', () => {
    mockTasks = { 'a-1': task('a-1', { description: 'reviewer subagent', command: 'run.sh', status: 'running' }) };
    render(card());

    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));
    const detail = screen.getByTestId('activity-detail-a-1');
    expect(detail).toHaveTextContent('reviewer subagent');
    expect(detail).toHaveTextContent('run.sh');
    expect(detail).toHaveTextContent('10m');

    fireEvent.click(screen.getByTestId('activity-drill-back-a-1'));
    expect(screen.queryByTestId('activity-detail-a-1')).toBeNull();
    expect(screen.getByTestId('activity-drill-open-a-1')).toBeInTheDocument();
  });

  it('shows the summary and usage when the daemon supplied them', () => {
    mockTasks = {
      'a-1': task('a-1', {
        status: 'completed',
        endedAt: 30_000,
        summary: 'it worked',
        usage: { totalTokens: 500, toolUses: 2, durationMs: 15_000 },
      }),
    };
    render(card());
    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));
    const detail = screen.getByTestId('activity-detail-a-1');
    expect(detail).toHaveTextContent('it worked');
    expect(detail).toHaveTextContent('500 tok');
  });
});

describe('ActivityCard — output tail (AC10, AC22)', () => {
  it('shows loading then lines for a task with output', async () => {
    mockTasks = { 'a-1': task('a-1', { outputPath: '/tmp/a-1.output' }) };
    getBackgroundTaskOutput.mockResolvedValue({ kind: 'text', text: 'hello\nworld' });
    render(card());
    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));

    await waitFor(() => expect(screen.getByTestId('activity-output-lines-a-1')).toHaveTextContent('hello'));
    expect(getBackgroundTaskOutput).toHaveBeenCalledWith('chat-1', 'a-1');
  });

  it('shows none for a task with no output location, without requesting it', () => {
    mockTasks = { 'a-1': task('a-1') };
    render(card());
    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));

    expect(screen.getByTestId('activity-output-none-a-1')).toBeInTheDocument();
    expect(getBackgroundTaskOutput).not.toHaveBeenCalled();
  });

  it('shows the error state on failure and refreshes on demand', async () => {
    mockTasks = { 'a-1': task('a-1', { outputPath: '/tmp/a-1.output' }) };
    getBackgroundTaskOutput.mockResolvedValue({ kind: 'error', message: 'invalid_path' });
    render(card());
    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));

    await waitFor(() => expect(screen.getByTestId('activity-output-error-a-1')).toHaveTextContent('invalid_path'));

    fireEvent.click(screen.getByTestId('activity-output-refresh-a-1'));
    await waitFor(() => expect(getBackgroundTaskOutput).toHaveBeenCalledTimes(2));
  });

  it('shows the agent transcript note and requests nothing, with no refresh control (AC22)', () => {
    mockTasks = { 'a-1': task('a-1', { kind: 'agent', outputPath: '/tmp/a-1.output' }) };
    render(card());
    fireEvent.click(screen.getByTestId('activity-drill-open-a-1'));

    expect(screen.getByTestId('activity-output-transcript-a-1')).toHaveTextContent(
      "This agent's output is its transcript",
    );
    expect(getBackgroundTaskOutput).not.toHaveBeenCalled();
    expect(screen.queryByTestId('activity-output-refresh-a-1')).toBeNull();
    expect(screen.queryByTestId('activity-output-none-a-1')).toBeNull();
  });
});

describe('ActivityCard — workflow drill-in', () => {
  beforeEach(() => {
    mockTasks = {
      'w-1': workflowTask('w-1', 'run_1', 'deploy'),
      'a-1': task('a-1', { kind: 'agent', description: 'reviewer subagent' }),
    };
    mockRuns = { 'w-1': workflowRun() };
  });

  it('lists a live workflow as a clickable row carrying its name and agent count', () => {
    render(card());
    const row = screen.getByTestId('session-panel-workflow-run_1');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveTextContent('deploy');
    expect(row).toHaveTextContent('1 agent');
  });

  it('falls back to a plain task row while the run is unknown', () => {
    mockRuns = {};
    render(card());
    expect(screen.queryByTestId('session-panel-workflow-run_1')).toBeNull();
    expect(screen.getByTestId('activity-drill-open-w-1')).toHaveTextContent('deploy');
  });

  it('opens the run panel, and the breadcrumb returns to the list', () => {
    render(card());
    fireEvent.click(screen.getByTestId('session-panel-workflow-run_1'));

    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-task-a-1')).toBeNull();

    fireEvent.click(screen.getByTestId('session-panel-workflow-back-run_1'));

    expect(screen.queryByTestId('chat-workflow-panel-run_1')).toBeNull();
    expect(screen.getByTestId('session-panel-workflow-run_1')).toBeInTheDocument();
  });

  it('still opens the run panel once the workflow is terminal', () => {
    mockTasks['w-1'] = workflowTask('w-1', 'run_1', 'deploy', { status: 'completed', endedAt: 1000 });
    mockRuns = { 'w-1': workflowRun({ status: 'completed' }) };
    render(card());
    fireEvent.click(screen.getByTestId('session-panel-workflow-run_1'));
    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
  });

  it('resets the drill-in when the chat id changes (M6)', () => {
    const { rerender } = render(card());
    fireEvent.click(screen.getByTestId('session-panel-workflow-run_1'));
    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();

    mockChatId = 'chat-2';
    rerender(card());

    expect(screen.queryByTestId('chat-workflow-panel-run_1')).toBeNull();
    expect(screen.getByTestId('session-panel-workflow-run_1')).toBeInTheDocument();
  });
});
