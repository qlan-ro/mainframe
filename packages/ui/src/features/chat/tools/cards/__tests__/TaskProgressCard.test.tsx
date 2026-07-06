/**
 * Behavior tests for TaskProgressCard — the _TaskProgress synthetic tool card.
 *
 * Each test passes a fixed, concrete props object and asserts the observable
 * DOM output — never re-derives the expected value using the card's own logic.
 *
 * The card reduces a list of TaskCreate/TaskUpdate items into a checklist.
 * Tests assert on the rendered text and testid attributes, not on intermediate
 * TaskState objects.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskProgressCard } from '../TaskProgressCard';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import type { TaskProgressItem } from '@/features/chat/view-model/message-meta';

// ---------------------------------------------------------------------------
// Wrapper — Radix Tooltip + Collapsible require a Provider
// ---------------------------------------------------------------------------

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const noop = () => {};
const doneStatus = { type: 'complete' as const };

const baseProps = {
  type: 'tool-call' as const,
  toolName: '_TaskProgress',
  toolCallId: 'tc-tp-001',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  isError: false as boolean | undefined,
  result: 'accumulated' as const,
  status: doneStatus,
};

// args.items carries TaskProgressItem[] which has non-JSON fields (result?:
// unknown). The cast is safe: the card's runtime behaviour under test does not
// depend on the JSON-serializability of its args.
//
// tp() merges baseProps with custom args/overrides so each JSX render site is
// assignable to ToolCallMessagePartProps without an inline cast.
function tp(
  args: { items?: TaskProgressItem[] },
  overrides?: { result?: unknown; status?: ToolCallMessagePartProps['status']; isError?: boolean },
): ToolCallMessagePartProps {
  return {
    ...baseProps,
    ...overrides,
    args: args as unknown as ToolCallMessagePartProps['args'],
  } as unknown as ToolCallMessagePartProps;
}

// ---------------------------------------------------------------------------
// Helpers to build TaskProgressItem fixtures
// ---------------------------------------------------------------------------

function makeCreate(id: string, subject: string): TaskProgressItem {
  return {
    toolName: 'TaskCreate',
    toolCallId: `tc-create-${id}`,
    args: { subject },
    result: `Task #${id}`,
    isError: false,
  };
}

function makeUpdate(taskId: string, status: string): TaskProgressItem {
  return {
    toolName: 'TaskUpdate',
    toolCallId: `tc-update-${taskId}`,
    args: { taskId, status },
    result: undefined,
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// Done state — card renders and shows tasks
// ---------------------------------------------------------------------------

describe('TaskProgressCard — done state', () => {
  it('renders the card root element', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Write tests')] })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-card')).toBeInTheDocument();
  });

  it('renders the "Tasks" header label', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Write tests')] })} />
      </Wrap>,
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });

  it('shows the task count in parentheses next to the label', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp({
            items: [makeCreate('1', 'Task one'), makeCreate('2', 'Task two'), makeCreate('3', 'Task three')],
          })}
        />
      </Wrap>,
    );
    // count label is "(3)" for 3 tasks
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('renders a pending task subject', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Refactor database layer')] })} />
      </Wrap>,
    );
    expect(screen.getByText('Refactor database layer')).toBeInTheDocument();
  });

  it('card opens by default (tasks visible without clicking)', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Do the thing')] })} />
      </Wrap>,
    );
    // defaultOpen — content is rendered immediately
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
  });

  it('clicking the toggle collapses the task list', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Do the thing')] })} />
      </Wrap>,
    );
    // Content is visible initially
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-task-progress-toggle'));
    expect(screen.queryByText('Do the thing')).not.toBeInTheDocument();
  });

  it('renders a pending task row with data-testid containing "pending"', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Pending task')] })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-item-pending')).toBeInTheDocument();
  });

  it('renders a completed task row with data-testid containing "completed"', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Write tests'), makeUpdate('1', 'completed')] })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-item-completed')).toBeInTheDocument();
  });

  it('renders an in_progress task row with data-testid containing "in_progress"', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Deploy app'), makeUpdate('1', 'in_progress')] })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-item-in_progress')).toBeInTheDocument();
  });

  it('renders multiple tasks with correct subjects', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp({
            items: [makeCreate('1', 'First task'), makeCreate('2', 'Second task'), makeCreate('3', 'Third task')],
          })}
        />
      </Wrap>,
    );
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
    expect(screen.getByText('Third task')).toBeInTheDocument();
  });

  it('TaskUpdate can change a task subject', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp({
            items: [
              makeCreate('1', 'Old subject'),
              {
                toolName: 'TaskUpdate',
                toolCallId: 'tc-update-1',
                args: { taskId: '1', subject: 'New subject' },
                result: undefined,
                isError: false,
              },
            ],
          })}
        />
      </Wrap>,
    );
    expect(screen.getByText('New subject')).toBeInTheDocument();
    expect(screen.queryByText('Old subject')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pending state (result === undefined / card still rendering stream)
// ---------------------------------------------------------------------------

describe('TaskProgressCard — pending state (result===undefined)', () => {
  it('renders tasks even when result is undefined (streaming)', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp(
            { items: [makeCreate('1', 'In-flight task')] },
            { result: undefined, status: { type: 'running' as const } },
          )}
        />
      </Wrap>,
    );
    expect(screen.getByText('In-flight task')).toBeInTheDocument();
  });

  it('shows correct count for in-flight tasks', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp(
            { items: [makeCreate('1', 'Task A'), makeCreate('2', 'Task B')] },
            { result: undefined, status: { type: 'running' as const } },
          )}
        />
      </Wrap>,
    );
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('TaskProgressCard — error state', () => {
  it('still renders tasks even when isError is true', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Task that errored')] }, { isError: true })} />
      </Wrap>,
    );
    expect(screen.getByText('Task that errored')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Deleted tasks — filtered out
// ---------------------------------------------------------------------------

describe('TaskProgressCard — deleted task filtering', () => {
  it('does not render tasks whose status is "deleted"', () => {
    render(
      <Wrap>
        <TaskProgressCard
          {...tp({
            items: [makeCreate('1', 'Should disappear'), makeUpdate('1', 'deleted'), makeCreate('2', 'Should stay')],
          })}
        />
      </Wrap>,
    );
    expect(screen.queryByText('Should disappear')).not.toBeInTheDocument();
    expect(screen.getByText('Should stay')).toBeInTheDocument();
  });

  it('returns null (renders nothing) when ALL tasks are deleted', () => {
    const { container } = render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeCreate('1', 'Task A'), makeUpdate('1', 'deleted')] })} />
      </Wrap>,
    );
    // The card renders null — no chat-task-progress-card in the DOM
    expect(container.querySelector('[data-testid="chat-task-progress-card"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty items array — renders nothing
// ---------------------------------------------------------------------------

describe('TaskProgressCard — empty items', () => {
  it('renders nothing when items array is empty', () => {
    const { container } = render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [] })} />
      </Wrap>,
    );
    expect(container.querySelector('[data-testid="chat-task-progress-card"]')).toBeNull();
  });

  it('renders nothing when args has no items key', () => {
    const { container } = render(
      <Wrap>
        <TaskProgressCard {...tp({})} />
      </Wrap>,
    );
    expect(container.querySelector('[data-testid="chat-task-progress-card"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TaskUpdate without a prior TaskCreate — creates an orphan task entry
// ---------------------------------------------------------------------------

describe('TaskProgressCard — TaskUpdate for unknown taskId', () => {
  it('creates a fallback task entry for an unknown taskId', () => {
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items: [makeUpdate('99', 'in_progress')] })} />
      </Wrap>,
    );
    // The card fabricates "Task #99" as the subject
    expect(screen.getByText('Task #99')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// daemon-shaped ToolCallResult objects — real id extraction + subject backfill
// ---------------------------------------------------------------------------

describe('TaskProgressCard — daemon-shaped ToolCallResult objects', () => {
  it('extracts real task ids from object results so updates attach to the right task', () => {
    // Creates get CLI ids 9 and 10 (object results); the update targets #10.
    const items: TaskProgressItem[] = [
      {
        toolCallId: 'c9',
        toolName: 'TaskCreate',
        args: { subject: 'Task 3: silent reconcile' },
        result: { content: 'Task #9 created successfully: Task 3: silent reconcile', isError: false },
        isError: false,
      },
      {
        toolCallId: 'c10',
        toolName: 'TaskCreate',
        args: { subject: 'Task 4: history unwrap' },
        result: { content: 'Task #10 created successfully: Task 4: history unwrap', isError: false },
        isError: false,
      },
      {
        toolCallId: 'u10',
        toolName: 'TaskUpdate',
        args: { taskId: '10', status: 'completed' },
        result: { content: 'Updated task #10 status', isError: false },
        isError: false,
      },
    ];
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items })} />
      </Wrap>,
    );
    // Exactly one completed row, and it is "Task 4: history unwrap" — NOT "Task 3" (positional-id collision).
    const completed = screen.getAllByTestId('chat-task-progress-item-completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toHaveTextContent('Task 4: history unwrap');
    expect(screen.getByTestId('chat-task-progress-item-pending')).toHaveTextContent('Task 3: silent reconcile');
    expect(screen.queryByText('Task #10')).not.toBeInTheDocument();
  });

  it('renders the daemon-backfilled subject for an orphan TaskUpdate (create in an earlier message)', () => {
    const items: TaskProgressItem[] = [
      {
        toolCallId: 'u9',
        toolName: 'TaskUpdate',
        args: { taskId: '9', status: 'completed', subject: 'Task 3: silent reconcile' },
        result: { content: 'Updated task #9 status', isError: false },
        isError: false,
      },
    ];
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-item-completed')).toHaveTextContent('Task 3: silent reconcile');
    expect(screen.queryByText('Task #9')).not.toBeInTheDocument();
  });

  it('falls back to Task #<id> only when no subject is available anywhere', () => {
    const items: TaskProgressItem[] = [
      {
        toolCallId: 'u7',
        toolName: 'TaskUpdate',
        args: { taskId: '7', status: 'in_progress' },
        result: { content: 'Updated task #7 status', isError: false },
        isError: false,
      },
    ];
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items })} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-progress-item-in_progress')).toHaveTextContent('Task #7');
  });

  it('does not let a result-less streaming create collide with a real numeric id already in the map', () => {
    // Two real creates (ids 2 and 3) are already known, then a create whose
    // result hasn't arrived yet (streaming) falls back to a positional id.
    // The old `String(map.size + 1)` fallback produces "3" here — colliding
    // with the real id-3 task and overwriting it in the reduction map.
    const items: TaskProgressItem[] = [
      {
        toolCallId: 'c2',
        toolName: 'TaskCreate',
        args: { subject: 'Task two' },
        result: { content: 'Task #2 created successfully: Task two', isError: false },
        isError: false,
      },
      {
        toolCallId: 'c3',
        toolName: 'TaskCreate',
        args: { subject: 'Task three' },
        result: { content: 'Task #3 created successfully: Task three', isError: false },
        isError: false,
      },
      {
        toolCallId: 'c-streaming',
        toolName: 'TaskCreate',
        args: { subject: 'Streaming task' },
        result: undefined,
        isError: false,
      },
      {
        toolCallId: 'u3',
        toolName: 'TaskUpdate',
        args: { taskId: '3', status: 'completed' },
        result: { content: 'Updated task #3 status', isError: false },
        isError: false,
      },
    ];
    render(
      <Wrap>
        <TaskProgressCard {...tp({ items })} />
      </Wrap>,
    );
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByText('Task two')).toBeInTheDocument();
    expect(screen.getByText('Task three')).toBeInTheDocument();
    expect(screen.getByText('Streaming task')).toBeInTheDocument();
    // The update targets the real id-3 task, not the streaming placeholder.
    const completed = screen.getAllByTestId('chat-task-progress-item-completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toHaveTextContent('Task three');
  });
});
