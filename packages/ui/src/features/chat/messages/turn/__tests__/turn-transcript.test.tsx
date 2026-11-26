import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { TurnFixture, assistant, bash, failed, running, system, text, tool, user } from './fixtures';

const { renderToolRow } = vi.hoisted(() => ({ renderToolRow: vi.fn() }));
vi.mock('../ToolRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ToolRow')>();
  return {
    ...actual,
    ToolRow: (props: React.ComponentProps<typeof actual.ToolRow>) => {
      renderToolRow(props.part.toolCallId);
      return <actual.ToolRow {...props} />;
    },
  };
});

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));

const header = () =>
  screen.getByRole('button', { name: /^((Finished|Running|Stopped|Ended on an error|Still going): )?Work(ed|ing)/ });
const isOpen = () => header().getAttribute('aria-expanded') === 'true';
const row = (id: string) => screen.queryByTestId(`chat-row-${id}`);

let roots = 0;
const root = () => `root-${++roots}`;
const show = (messages: ThreadMessage[], props: Partial<Parameters<typeof TurnFixture>[0]> = {}) => {
  const rootId = root();
  const view = render(<TurnFixture rootId={rootId} messages={messages} {...props} />);
  return {
    ...view,
    update: (next: ThreadMessage[], more: Partial<Parameters<typeof TurnFixture>[0]> = {}) =>
      view.rerender(<TurnFixture rootId={rootId} messages={next} {...props} {...more} />),
  };
};

beforeEach(() => useUiPrefs.setState({ finishedWork: 'fold' }));
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  vi.clearAllMocks();
});

describe('the work row', () => {
  it('folds an ended turn under one row and keeps its answer', () => {
    show([
      user('Hi'),
      assistant([bash('b', 'ls'), text('Looking'), tool(), text('All done')], 'a', { timing: 134_000 }),
    ]);
    expect(header()).toHaveAccessibleName('Worked for 2m 14s, read 1 file, ran 1 command');
    expect(isOpen()).toBe(false);
    expect(row('b')).toBeNull();
    expect(screen.getByText('All done')).toBeVisible();
    expect(screen.queryByText('Looking')).toBeNull();
  });

  it('does not mount completed tool rows when replay first populates a folded transcript', () => {
    show([user('Hi'), assistant([bash('replayed', 'ls'), text('Done')])]);
    expect(renderToolRow).not.toHaveBeenCalledWith('replayed');
    expect(isOpen()).toBe(false);
    fireEvent.click(header());
    expect(row('replayed')).toBeVisible();
    expect(renderToolRow).toHaveBeenCalledWith('replayed');
  });

  it('opens on its rows, with the agent’s words between them', () => {
    show([user('Hi'), assistant([bash('b', 'ls'), text('Looking'), tool(), text('All done')])]);
    fireEvent.click(header());
    expect(row('b')).toBeVisible();
    expect(screen.getByText('Looking')).toBeVisible();
    expect(row('read-a')).toBeVisible();
    fireEvent.click(header());
    expect(row('b')).toBeNull();
  });

  it('is open while the turn runs and folds once it ends', async () => {
    const step = bash('b', 'ls');
    const view = show([user('Hi'), assistant([step], 'a', { running: true })]);
    expect(header()).toHaveAccessibleName(/^Running: Working/);
    expect(row('b')).toBeVisible();
    view.update([user('Hi'), assistant([step, text('Done')], 'a')]);
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it('stays open when the setting keeps finished work open', () => {
    useUiPrefs.setState({ finishedWork: 'open' });
    show([user('Hi'), assistant([bash('b', 'ls'), text('Done')])]);
    expect(isOpen()).toBe(true);
  });

  it('draws one row for a turn a compaction splits, and none for a plain reply', () => {
    show([
      user('Hi'),
      assistant([bash('one', 'ls')], 'a1'),
      system('s', { isCompacted: true }),
      assistant([bash('two', 'pwd'), text('Done')], 'a2'),
      user('Thanks', 'u2'),
      assistant([text('Welcome')], 'a3'),
    ]);
    expect(screen.getAllByTestId(/^chat-work-header-/)).toHaveLength(1);
    fireEvent.click(header());
    expect(row('one')).toBeVisible();
    expect(row('two')).toBeVisible();
  });

  it.each([
    ['cancelled', 'Stopped', 'stopped'],
    ['failed', 'Ended on an error', 'error'],
    ['completed', 'Finished', 'finished'],
  ] as const)('says how a %s turn ended', (state, word, at) => {
    show([user('Hi'), assistant([bash('b', 'ls'), text('Done')], 'a', { presentation: { state } })]);
    expect(header()).toHaveAccessibleName(new RegExp(`^${word}:`));
    expect(header().parentElement).toHaveAttribute('data-work-state', at);
  });

  it('claims no end nobody told of, and shows no check', () => {
    show([user('Hi'), assistant([bash('b', 'ls'), text('Done')], 'a', { presentation: { state: 'invalid' } })]);
    expect(header()).toHaveAccessibleName('Worked, ran 1 command');
    expect(header().parentElement).toHaveAttribute('data-work-state', 'neutral');
    expect(header().parentElement!.querySelector('.lucide-check')).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it('does not fold a turn that claims no end while a step’s outcome is unknown', () => {
    const lost = bash('b', 'ls', { result: undefined, providerMetadata: {} });
    const said = { presentation: { state: 'invalid' } } as const;
    show([user('Hi'), assistant([lost, text('Done')], 'a', said)]);
    expect([header().getAttribute('aria-label'), isOpen()]).toEqual(['Worked, ran 1 command', true]);
  });
});

describe('what keeps a turn open', () => {
  const step = bash('b', 'ls');
  const live = [user('Hi'), assistant([step], 'a', { running: true })];
  const ended = [user('Hi'), assistant([step, text('Done')], 'a')];

  it('the viewer’s own choice', async () => {
    const view = show(live);
    fireEvent.click(header());
    expect(isOpen()).toBe(false);
    fireEvent.click(header());
    view.update(ended);
    await act(async () => {});
    expect(isOpen()).toBe(true);
  });

  it('a row they opened, until they close it', async () => {
    const view = show(live);
    fireEvent.click(screen.getByTestId('chat-row-b-toggle'));
    view.update(ended);
    await act(async () => {});
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByTestId('chat-row-b-toggle'));
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it('a selection inside it, until it clears', async () => {
    const view = show(live);
    const range = document.createRange();
    range.selectNodeContents(row('b')!);
    document.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    view.update(ended);
    await act(async () => {});
    expect(isOpen()).toBe(true);
    document.getSelection()!.removeAllRanges();
    fireEvent(document, new Event('selectionchange'));
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it('focus inside it', async () => {
    const view = show(live);
    act(() => screen.getByTestId('chat-row-b-toggle').focus());
    view.update(ended);
    await act(async () => {});
    expect(isOpen()).toBe(true);
  });
});

describe('streaming', () => {
  it('keeps the text node of a line that becomes a step', async () => {
    const view = show([user('Hi'), assistant([text('Let me check')], 'a', { running: true })]);
    const node = await screen.findByText('Let me check');
    view.update([user('Hi'), assistant([text('Let me check'), bash('b', 'ls', running)], 'a', { running: true })]);
    await waitFor(() => expect(node.closest('[data-work-turn]')).not.toBeNull());
    expect(screen.getByText('Let me check')).toBe(node);
  });

  it('shows a running step with its live verb', () => {
    show([user('Hi'), assistant([bash('b', 'cargo test', running)], 'a', { running: true })]);
    const step = within(row('b')!);
    expect(step.getByText('Running', { selector: 'span:not(.sr-only)' })).toBeVisible();
    expect(step.getByText('cargo test')).toBeVisible();
  });
});

describe('a manual choice', () => {
  it('outlives a step that turns out failed', async () => {
    const view = show([user('Hi'), assistant([bash('b', 'ls'), text('Done')])]);
    fireEvent.click(header());
    fireEvent.click(header());
    view.update([user('Hi'), assistant([bash('b', 'ls', failed), text('Done')])]);
    await act(async () => {});
    expect(isOpen()).toBe(false);
    expect(screen.getByRole('button', { name: '1 failed: show the failed step' })).toBeVisible();
  });
});

describe('the path menu', () => {
  it('wraps a message once, and none wraps the error a turn ended on', () => {
    show([user('Hi'), assistant([bash('b', 'ls'), text('Done')])]);
    expect(screen.getAllByTestId('chat-message-menu-trigger')).toHaveLength(1);
  });
  it('is not on an error', () => {
    show([user('Hi'), assistant([text('Boom')], 'e', { custom: { errorText: 'Provider disconnected' } })]);
    expect(screen.getByTestId('chat-error-block')).toHaveTextContent('Provider disconnected');
    expect(screen.queryByTestId('chat-message-menu-trigger')).toBeNull();
  });
});

describe('copying a reply', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }));
  const lastCopy = () => {
    const buttons = screen.getAllByTestId('chat-message-copy');
    return buttons[buttons.length - 1]!;
  };
  const copyReply = async () => {
    fireEvent.click(lastCopy());
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    return writeText.mock.lastCall![0] as string;
  };

  it('takes the whole answer when it spans messages', async () => {
    show([
      user('Hi'),
      assistant([bash('b', 'ls'), text('First 🛠️ half.')], 'a1'),
      system('s', { isCompacted: true }),
      assistant([text('Second half é.')], 'a2'),
    ]);
    expect(await copyReply()).toBe('First 🛠️ half.\n\nSecond half é.');
    await waitFor(() => expect(lastCopy()).toHaveAttribute('data-copied', 'true'));
  });

  it('leaves out the lines between steps', async () => {
    show([user('Hi'), assistant([text('Looking'), bash('b', 'ls'), text('Done')], 'a1')]);
    expect(await copyReply()).toBe('Done');
  });

  it('takes the viewer’s own message as it is', async () => {
    show([user('Hi there'), assistant([text('Done')])]);
    fireEvent.click(screen.getAllByTestId('chat-message-copy')[0]!);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Hi there'));
  });

  it('is not offered while the turn runs', () => {
    show([user('Hi'), assistant([text('Wor')], 'a', { running: true })]);
    expect(screen.getAllByTestId('chat-message-copy')).toHaveLength(1);
  });
});

describe('failures', () => {
  it('open by themselves in an artifact’s row', () => {
    const publish = tool({
      toolCallId: 'art',
      toolName: 'Artifact',
      args: { title: 'Plan' },
      ...failed,
      result: 'Denied',
    });
    show([user('Hi'), assistant([publish, text('Hm')])]);
    fireEvent.click(header());
    expect(screen.getByTestId('artifact-card-result')).toHaveTextContent('Denied');
  });

  it('counts an unresolved failure in the header and opens the turn on it', async () => {
    show([user('Hi'), assistant([bash('bad', 'vitest', failed), text('Hm')])]);
    const count = screen.getByRole('button', { name: '1 failed: show the failed step' });
    expect(count).toHaveAttribute('data-retried', 'false');
    fireEvent.click(count);
    await waitFor(() => expect(isOpen()).toBe(true));
    // The last step failed, so its output is already visible.
    expect(await screen.findByTestId('chat-bash-output')).toHaveTextContent('boom');
    await waitFor(() => expect(screen.getByTestId('chat-row-bad-toggle')).toHaveFocus());
  });

  it('reads a retried failure in grey and leaves its row closed', async () => {
    show([user('Hi'), assistant([bash('bad', 'vitest', failed), bash('good', 'vitest'), text('ok')])]);
    expect(screen.getByRole('button', { name: '1 failed, retried: show the step' })).toHaveAttribute(
      'data-retried',
      'true',
    );
    fireEvent.click(header());
    expect(screen.getByTestId('chat-row-bad-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

it('draws a picture made between steps as a row', () => {
  const picture = { type: 'image', image: 'data:image/png;base64,AA' } as const;
  show([user('Hi'), assistant([bash('b', 'ls'), picture, tool(), text('Done')], 'pic')]);
  expect(header()).toHaveAccessibleName(/generated 1 image/);
  fireEvent.click(header());
  expect(screen.getByTestId('chat-image-pic-1')).toHaveTextContent('Generated image');
});

describe('explored runs', () => {
  const read = (n: number) => tool({ toolCallId: `r${n}`, args: { file_path: `/src/${n}.ts` } });
  it('folds four or more reads and searches into one row, naming their calls', () => {
    show([
      user('Hi'),
      assistant([
        read(1),
        read(2),
        read(3),
        tool({ toolCallId: 'g', toolName: 'Grep', args: { pattern: 'x' } }),
        text('ok'),
      ]),
    ]);
    fireEvent.click(header());
    const group = screen.getByTestId('chat-explore-r1');
    expect(group).toHaveAttribute('data-activity-group', 'r1 r2 r3 g');
    expect(group).toHaveTextContent('Explored');
    expect(group).toHaveTextContent('3 files, 1 search');
    expect(row('r1')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-explore-r1-toggle'));
    expect(row('r1')).toBeVisible();
  });

  it('lists a shorter run as rows', () => {
    show([user('Hi'), assistant([read(1), read(2), read(3), text('ok')])]);
    fireEvent.click(header());
    expect(row('r3')).toBeVisible();
  });
});

describe('the jump contract', () => {
  it('opens the turn its call is in and carries the call id on the row', async () => {
    show([user('Hi'), assistant([bash('b', 'ls'), text('Done')], 'a')]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ACTIVITY_JUMP_EVENT, {
          detail: { chatId: undefined, source: { messageId: 'a', toolCallId: 'b' } },
        }),
      );
    });
    await waitFor(() => expect(row('b')).toBeVisible());
    expect(row('b')).toHaveAttribute('data-activity-id', 'b');
    expect(row('b')!.querySelector('[aria-expanded]')).toBe(screen.getByTestId('chat-row-b-toggle'));
  });
});

describe('footers and times', () => {
  it('gives each message one footer with its time, and the turn only one', () => {
    show([
      user('Hi'),
      assistant([bash('b', 'ls')], 'a1'),
      system('s', { isCompacted: true }),
      assistant([text('Done')], 'a2'),
    ]);
    expect(screen.getAllByTestId('chat-message-footer')).toHaveLength(2);
    expect(screen.getAllByTestId('chat-message-timestamp')).toHaveLength(2);
  });

  it('marks the time where the conversation starts', () => {
    show([user('Hi'), assistant([text('Hello')])]);
    expect(screen.getAllByTestId('chat-time-marker')).toHaveLength(1);
  });
});
