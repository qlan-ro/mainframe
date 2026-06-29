/**
 * Behavior tests for TaskCard — the subagent (Task tool) card.
 *
 * Each test passes a fixed, concrete props object and asserts the observable
 * DOM output — never re-derives the expected value using the card's own logic.
 *
 * Mocked seams:
 *  - chat-tool-context: stubs so ErrorDot's parent module loads cleanly
 *  - AssistantMessage / UserMessage / SystemMessage: replaced with a stable
 *    sentinel so ReadonlyThreadProvider doesn't need a full assistant-ui
 *    runtime to render the expanded transcript.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks — must come before the component import
// ---------------------------------------------------------------------------

vi.mock('@/features/chat/tools/chat-tool-context', () => ({
  useChatId: () => undefined,
  useOpenFile: () => ({ openFile: () => {}, revealFile: () => {} }),
}));

// Stub the message components so ReadonlyThreadProvider renders something
// predictable without needing a real external-store runtime.
vi.mock('@/features/chat/messages/AssistantMessage', () => ({
  AssistantMessage: () => <div data-testid="stub-assistant-message">assistant</div>,
}));
vi.mock('@/features/chat/messages/UserMessage', () => ({
  UserMessage: () => <div data-testid="stub-user-message">user</div>,
}));
vi.mock('@/features/chat/messages/SystemMessage', () => ({
  SystemMessage: () => <div data-testid="stub-system-message">system</div>,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { TaskCard } from '../TaskCard';

// ---------------------------------------------------------------------------
// Shared wrapper — Radix Tooltip requires a Provider
// ---------------------------------------------------------------------------

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const noop = () => {};
const doneStatus = { type: 'complete' as const };
const runningStatus = { type: 'running' as const };

const baseProps = {
  type: 'tool-call' as const,
  toolName: 'Task',
  toolCallId: 'tc-task-001',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  isError: false as boolean | undefined,
};

// ---------------------------------------------------------------------------
// Done state
// ---------------------------------------------------------------------------

describe('TaskCard — done state', () => {
  it('renders the card root element', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'claude-code', model: 'claude-opus-4', description: 'Refactor auth module' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-card')).toBeInTheDocument();
  });

  it('renders the agent name from subagent_type arg', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'claude-code', description: 'Do something' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-agent')).toHaveTextContent('claude-code');
  });

  it('falls back to "Task" as agent name when subagent_type is absent', () => {
    render(
      <Wrap>
        <TaskCard {...baseProps} args={{ description: 'Some task' }} result={'done'} status={doneStatus} />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-agent')).toHaveTextContent('Task');
  });

  it('renders the description in the header', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Write unit tests' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-description')).toHaveTextContent('Write unit tests');
  });

  it('trims description to 80 chars with ellipsis in the header', () => {
    const long = 'A'.repeat(85);
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: long }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    // The header must show exactly 80 chars + ellipsis character (not the full string)
    expect(screen.getByTestId('chat-task-description')).toHaveTextContent('A'.repeat(80) + '…');
  });

  it('renders description from prompt arg when description is absent', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', prompt: 'Run the linter' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-description')).toHaveTextContent('Run the linter');
  });

  it('renders the model label when model arg is present', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'claude-code', model: 'claude-opus-4', description: 'Fix bug' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    // TruncatedWithTooltip always renders the text as a visible span; the tooltip
    // only opens on hover when the text is actually clipped (jsdom reports no clipping).
    expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
  });

  it('does NOT show the running pulse dot when result is present', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Do something' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.queryByLabelText('Subagent running')).not.toBeInTheDocument();
  });

  it('does NOT show the error dot when isError is false', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Do something' }}
          result={'done'}
          isError={false}
          status={doneStatus}
        />
      </Wrap>,
    );
    // ErrorDot renders nothing when isError is falsy
    expect(screen.queryByTestId('chat-task-error-dot')).not.toBeInTheDocument();
  });

  it('toggle button carries accessible aria-label for the agent name', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'my-agent', description: 'A task' }}
          result={'done'}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByLabelText('Toggle my-agent transcript')).toBeInTheDocument();
  });

  it('card is collapsed by default (no transcript visible)', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Do something' }}
          result={'done'}
          status={doneStatus}
          messages={[
            {
              id: 'msg-1',
              role: 'user',
              content: [{ type: 'text', text: 'Hello' }],
              status: { type: 'complete' },
              metadata: { unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
            } as unknown as import('@assistant-ui/react').ThreadMessage,
          ]}
        />
      </Wrap>,
    );
    // stub-user-message only appears when the CollapsibleContent is expanded
    expect(screen.queryByTestId('stub-user-message')).not.toBeInTheDocument();
  });

  it('clicking the toggle button expands the transcript', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Do something' }}
          result={'done'}
          status={doneStatus}
          messages={[
            {
              id: 'msg-1',
              role: 'user',
              content: [{ type: 'text', text: 'Hello' }],
              status: { type: 'complete' },
              metadata: { unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
            } as unknown as import('@assistant-ui/react').ThreadMessage,
          ]}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('chat-task-toggle'));
    expect(screen.getByTestId('stub-user-message')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pending state (result === undefined)
// ---------------------------------------------------------------------------

describe('TaskCard — pending state (result===undefined)', () => {
  it('shows the running pulse dot when result is undefined', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Searching...' }}
          result={undefined}
          status={runningStatus}
        />
      </Wrap>,
    );
    expect(screen.getByLabelText('Subagent running')).toBeInTheDocument();
  });

  it('shows the running pulse dot when status.type is running (even with result)', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Still running' }}
          result={undefined}
          status={runningStatus}
        />
      </Wrap>,
    );
    expect(screen.getByLabelText('Subagent running')).toBeInTheDocument();
  });

  it('still renders the agent name and description in pending state', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'my-agent', description: 'In progress...' }}
          result={undefined}
          status={runningStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-agent')).toHaveTextContent('my-agent');
    expect(screen.getByTestId('chat-task-description')).toHaveTextContent('In progress...');
  });

  it('card is still collapsed by default in pending state', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Running...' }}
          result={undefined}
          status={runningStatus}
        />
      </Wrap>,
    );
    expect(screen.queryByTestId('stub-user-message')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('TaskCard — error state', () => {
  it('shows the error dot when isError is true', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Failed task' }}
          result={'Task failed: timeout'}
          isError={true}
          status={doneStatus}
        />
      </Wrap>,
    );
    // ErrorDot renders a span with bg-destructive class when isError is true
    const card = screen.getByTestId('chat-task-card');
    // The ErrorDot span is inside the card; it has no testid but has bg-destructive
    const dot = card.querySelector('.bg-destructive');
    expect(dot).not.toBeNull();
  });

  it('does NOT show the running pulse dot when result is present even with isError', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Failed task' }}
          result={'error result'}
          isError={true}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.queryByLabelText('Subagent running')).not.toBeInTheDocument();
  });

  it('still renders the agent name in error state', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'broken-agent', description: 'It crashed' }}
          result={'crash'}
          isError={true}
          status={doneStatus}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-task-agent')).toHaveTextContent('broken-agent');
  });
});

// ---------------------------------------------------------------------------
// Empty messages — renders nothing in body
// ---------------------------------------------------------------------------

describe('TaskCard — empty messages', () => {
  it('expanded card with no messages renders no transcript body', () => {
    render(
      <Wrap>
        <TaskCard
          {...baseProps}
          args={{ subagent_type: 'worker', description: 'Done' }}
          result={'done'}
          status={doneStatus}
          messages={[]}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('chat-task-toggle'));
    // No message stubs should appear
    expect(screen.queryByTestId('stub-user-message')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-assistant-message')).not.toBeInTheDocument();
  });
});
