/** useAgentTasks — the task list of one agent's call: what is kept, when it is asked again, and when it counts. */
import { act, render } from '@testing-library/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusProvider, type ConnectionStatus } from '@/app/ConnectionStatusContext';

/** Requests answered by hand, in the order they were made. */
const requests: {
  chatId: string;
  daemonId: string;
  signal?: AbortSignal;
  answer: (tasks: BackgroundTask[]) => void;
  refuse: () => void;
}[] = [];
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: (chatId: string, signal?: AbortSignal) =>
    new Promise((resolve, reject) => {
      const daemonId = getActiveDaemon().id;
      signal?.addEventListener('abort', () => reject(signal.reason));
      requests.push({ chatId, daemonId, signal, answer: resolve, refuse: () => reject(new Error('refused')) });
    }),
}));

import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useAgentTasks } from '../use-agent-tasks';

const row = (status: BackgroundTask['status'], overrides: Partial<BackgroundTask> = {}) =>
  ({ id: 'bg-1', toolUseId: 'call-1', status, startedAt: 1, ...overrides }) as BackgroundTask;

interface Props {
  events?: object;
  visible?: boolean;
  chatId?: string;
  callId?: string;
  connected?: boolean;
}
type Shown = ReturnType<typeof useAgentTasks>;
function Probe({
  events,
  visible = true,
  chatId = 'parent',
  callId = 'call-1',
  tell,
}: Props & { tell: (shown: Shown) => void }) {
  tell(useAgentTasks(chatId, callId, events as never, visible));
  return null;
}
function mount(initial: Props = {}) {
  let shown: Shown;
  let props: Props = { events: {}, connected: true, ...initial };
  const tree = ({ connected, ...rest }: Props) => (
    <ConnectionStatusProvider
      value={{ state: connected ? 'connected' : 'reconnecting', daemonStatus: '' } as ConnectionStatus}
    >
      <Probe {...rest} tell={(next) => (shown = next)} />
    </ConnectionStatusProvider>
  );
  const view = render(tree(props));
  /** A background event, or another change of props. */
  const set = (next: Props = { events: {} }) => view.rerender(tree((props = { ...props, ...next })));
  return {
    get: () => shown,
    statuses: () => shown.tasks?.map((task) => task.status) ?? null,
    set,
    connect: (connected: boolean) => set({ connected }),
    unmount: view.unmount,
  };
}
const answer = (at: number, ...tasks: BackgroundTask[]) => act(async () => requests[at]!.answer(tasks));
const refuse = (at: number) => act(async () => requests[at]!.refuse());
/** The requests still on their way. */
const open = () => requests.filter(({ signal }) => !signal?.aborted);
const pass = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

const daemon = (id: string) => act(() => setActiveDaemon({ ...getActiveDaemon(), id }));

beforeEach(() => {
  vi.useFakeTimers();
  setActiveDaemon({ ...getActiveDaemon(), id: 'local' });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  requests.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what it lists', () => {
  it('is nothing known until the first answer, then this call’s own tasks', async () => {
    const hook = mount();
    expect(hook.get()).toEqual({ tasks: null, live: true });
    await answer(0, row('running'), row('failed', { id: 'bg-2', toolUseId: 'call-2' }));
    expect(hook.statuses()).toEqual(['running']);
    expect(requests.map((request) => request.chatId)).toEqual(['parent']);
  });

  it('keeps a settled row settled, whatever a later list says of that run', async () => {
    const hook = mount();
    await answer(0, row('stopped'));
    hook.set();
    await answer(1, row('running'));
    expect(hook.statuses()).toEqual(['stopped']);
    hook.set();
    await answer(2);
    expect(hook.statuses()).toEqual(['stopped']);
  });

  it('takes the same task’s next run as a run of its own', async () => {
    const hook = mount();
    await answer(0, row('completed'));
    hook.set();
    await answer(1, row('running', { startedAt: 2 }));
    expect(hook.statuses()).toEqual(['running']);
  });

  it('drops a running row a later list does not have', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set();
    await answer(1);
    expect(hook.statuses()).toEqual([]);
  });

  it('forgets one chat’s rows in another', async () => {
    const hook = mount();
    await answer(0, row('failed'));
    hook.set({ chatId: 'other' });
    expect(hook.statuses()).toBeNull();
    expect(requests[1]!.chatId).toBe('other');
    await answer(1);
    expect(hook.statuses()).toEqual([]);
  });

  it('keeps one daemon’s settled rows from another’s, whose chat has the same id', async () => {
    const hook = mount();
    await answer(0, row('failed'));
    daemon('remote');
    expect(hook.statuses()).toBeNull();
    expect(requests[1]).toMatchObject({ chatId: 'parent', daemonId: 'remote' });
    await answer(1, row('running'));
    expect(hook.statuses()).toEqual(['running']);
  });

  it('keeps one call’s settled rows from another’s, also for the same task', async () => {
    const hook = mount();
    await answer(0, row('failed'));
    hook.set({ callId: 'call-2' });
    expect(hook.statuses()).toEqual([]);
    hook.set();
    await answer(1, row('running', { toolUseId: 'call-2' }));
    expect(hook.statuses()).toEqual(['running']);
    hook.set({ callId: 'call-1' });
    expect(hook.statuses()).toEqual(['failed']);
  });

  it('starts over once no tab reads it', async () => {
    const first = mount();
    await answer(0, row('failed'));
    first.unmount();
    expect(mount().statuses()).toBeNull();
  });
});

describe('two visible tabs', () => {
  it('of one agent share one request, on showing, on an event, and on a retry', async () => {
    const one = mount();
    const two = mount();
    expect(requests).toHaveLength(1);
    await answer(0, row('running'));
    expect([one.statuses(), two.statuses()]).toEqual([['running'], ['running']]);

    const events = {};
    one.set({ events });
    two.set({ events });
    expect(requests).toHaveLength(2);
    await refuse(1);
    await pass(1_000);
    expect(requests).toHaveLength(3);
    await answer(2, row('completed'));
    await pass(60_000);
    expect(requests).toHaveLength(3);
    expect([one.statuses(), two.statuses()]).toEqual([['completed'], ['completed']]);
  });

  it.each([
    ['hidden', (hook: ReturnType<typeof mount>) => hook.set({ visible: false })],
    ['closed', (hook: ReturnType<typeof mount>) => hook.unmount()],
  ])('go on asking when one is %s, and stop with the last', async (_, leave) => {
    const one = mount();
    const two = mount();
    leave(one);
    expect(open()).toHaveLength(1);
    await answer(0, row('running'));
    expect(two.statuses()).toEqual(['running']);
    two.set();
    expect(requests).toHaveLength(2);
    leave(two);
    expect(open()).toHaveLength(1);
    await pass(60_000);
    expect(requests).toHaveLength(2);
  });

  it('of different agents each have their own rows', async () => {
    const one = mount();
    const two = mount({ callId: 'call-2' });
    await answer(0, row('running'), row('failed', { id: 'bg-2', toolUseId: 'call-2' }));
    expect([one.statuses(), two.statuses()]).toEqual([['running'], ['failed']]);
  });

  it('of different chats ask for their own', () => {
    mount();
    mount({ chatId: 'other' });
    expect(requests.map(({ chatId }) => chatId)).toEqual(['parent', 'other']);
  });
});

describe('asking again', () => {
  it('keeps the last list and stays live while the answer is on its way', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set();
    expect(requests).toHaveLength(2);
    expect(hook.get().live).toBe(true);
    expect(hook.statuses()).toEqual(['running']);
    await answer(1, row('completed'));
    expect(hook.statuses()).toEqual(['completed']);
  });

  it('asks once more after a burst of events, and only when the first is answered', async () => {
    const hook = mount();
    hook.set();
    hook.set();
    hook.set();
    expect(requests).toHaveLength(1);
    await answer(0, row('running'));
    expect(requests).toHaveLength(2);
    expect(hook.statuses()).toEqual(['running']);
    await answer(1, row('completed'));
    await pass(60_000);
    expect(requests).toHaveLength(2);
  });

  it('does not ask for a render that is no event', async () => {
    const hook = mount();
    await answer(0);
    hook.set({});
    expect(requests).toHaveLength(1);
  });

  it('after a refusal asks again by itself, waiting longer each time, and keeps the last list', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set();
    await refuse(1);
    expect(hook.get().live).toBe(true);
    expect(hook.statuses()).toEqual(['running']);

    for (const [n, wait] of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000].entries()) {
      await pass(wait - 1);
      expect(requests).toHaveLength(n + 2);
      await pass(1);
      expect(requests).toHaveLength(n + 3);
      await refuse(n + 2);
    }
    await pass(10_000);
    await answer(8, row('completed'));
    expect(hook.statuses()).toEqual(['completed']);

    hook.set();
    await refuse(9);
    await pass(1_000);
    expect(requests).toHaveLength(11);
  });

  it('lets an event wait for the retry, which answers it too', async () => {
    const hook = mount();
    await refuse(0);
    hook.set();
    expect(requests).toHaveLength(1);
    await pass(1_000);
    expect(requests).toHaveLength(2);
    await answer(1, row('running'));
    await pass(60_000);
    expect(requests).toHaveLength(2);
  });

  it('gives up a request that never answers, before it asks again, and takes no late answer to it', async () => {
    const hook = mount();
    await pass(14_999);
    expect(open()).toHaveLength(1);
    await pass(1);
    expect(requests).toHaveLength(1);
    expect(open()).toHaveLength(0);
    await pass(1_000);
    expect(requests).toHaveLength(2);
    expect(open()).toEqual([requests[1]]);
    await answer(1, row('completed'));
    await answer(0, row('running'));
    expect(hook.statuses()).toEqual(['completed']);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.signal?.aborted).toBe(false);
  });

  it.each([
    ['hidden', (hook: ReturnType<typeof mount>) => hook.set({ visible: false })],
    ['closed', (hook: ReturnType<typeof mount>) => hook.unmount()],
    ['disconnected', (hook: ReturnType<typeof mount>) => hook.connect(false)],
  ])('gives up the request on its way once the tab is %s', async (_, leave) => {
    const hook = mount();
    leave(hook);
    expect(open()).toHaveLength(0);
    await pass(60_000);
    expect(requests).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', (hook: ReturnType<typeof mount>) => hook.set({ visible: false })],
    ['closed', (hook: ReturnType<typeof mount>) => hook.unmount()],
    ['disconnected', (hook: ReturnType<typeof mount>) => hook.connect(false)],
  ])('does not retry once the tab is %s', async (_, leave) => {
    const hook = mount();
    await refuse(0);
    leave(hook);
    await pass(60_000);
    expect(requests).toHaveLength(1);
  });

  it('does not ask behind another tab, and shows the last list while it asks again in front', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set({ visible: false });
    hook.set({ events: {} });
    expect(requests).toHaveLength(1);
    hook.set({ visible: true });
    expect(requests).toHaveLength(2);
    expect(hook.statuses()).toEqual(['running']);
  });
});

describe('a list that cannot be confirmed', () => {
  /** A list now, then an event and nothing but refusals for `ms`. */
  async function refusedFor(hook: ReturnType<typeof mount>, ms: number) {
    hook.set();
    const until = Date.now() + ms;
    await refuse(requests.length - 1);
    while (Date.now() < until) {
      await pass(Math.min(1_000, until - Date.now()));
      if (open().length && Date.now() < until) await refuse(requests.length - 1);
    }
  }

  it('is live for 30 s of refusals, and not after them; its rows stay', async () => {
    const hook = mount();
    await answer(0, row('running'));
    await refusedFor(hook, 29_999);
    expect(hook.get().live).toBe(true);
    await pass(1);
    expect(hook.get().live).toBe(false);
    expect(hook.statuses()).toEqual(['running']);
  });

  it('is live for 30 s also when the requests hang', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set();
    await pass(29_999);
    expect(hook.get().live).toBe(true);
    await pass(1);
    expect(hook.get().live).toBe(false);
  });

  it('is live again once a list has come', async () => {
    const hook = mount();
    await answer(0, row('running'));
    await refusedFor(hook, 40_000);
    expect(hook.get().live).toBe(false);
    await pass(10_000);
    await answer(requests.length - 1, row('running'));
    expect(hook.get().live).toBe(true);
    await pass(120_000);
    expect(hook.get().live).toBe(true);
  });

  it('counts the 30 s from the latest list', async () => {
    const hook = mount();
    await answer(0, row('running'));
    await pass(20_000);
    hook.set();
    await answer(1, row('running'));
    await refusedFor(hook, 29_999);
    expect(hook.get().live).toBe(true);
    await pass(1);
    expect(hook.get().live).toBe(false);
  });

  it('is live however old while nothing is refused', async () => {
    const hook = mount();
    await answer(0, row('running'));
    await pass(600_000);
    expect(hook.get().live).toBe(true);
    hook.set();
    expect(hook.get().live).toBe(true);
    await refuse(1);
    expect(hook.get().live).toBe(false);
  });

  it('is not live after a refusal with no list before it', async () => {
    const hook = mount();
    expect(hook.get().live).toBe(true);
    await refuse(0);
    expect(hook.get()).toEqual({ tasks: null, live: false });
  });
});

describe('the connection', () => {
  it('keeps the list but is not live while it is gone, nor until a list has come after it', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.connect(false);
    expect(hook.get().live).toBe(false);
    expect(hook.statuses()).toEqual(['running']);
    hook.connect(true);
    expect(hook.get().live).toBe(false);
    expect(requests).toHaveLength(2);
    await refuse(1);
    expect(hook.get().live).toBe(false);
    await pass(1_000);
    await answer(2, row('running'));
    expect(hook.get().live).toBe(true);
  });

  it('takes no answer to a request from before it was lost', async () => {
    const hook = mount();
    hook.connect(false);
    hook.connect(true);
    await answer(0, row('running'));
    expect(hook.get()).toEqual({ tasks: null, live: false });
    await answer(1, row('completed'));
    expect(hook.get().live).toBe(true);
    expect(hook.statuses()).toEqual(['completed']);
  });

  it('that was never there is not live until the first list', async () => {
    const hook = mount({ connected: false });
    expect(hook.get()).toEqual({ tasks: null, live: false });
    expect(requests).toHaveLength(0);
    hook.connect(true);
    expect(hook.get().live).toBe(false);
    await answer(0);
    expect(hook.get()).toEqual({ tasks: [], live: true });
  });

  it('that was lost behind another tab is still not live in front', async () => {
    const hook = mount();
    await answer(0, row('running'));
    hook.set({ visible: false });
    hook.connect(false);
    hook.connect(true);
    hook.set({ visible: true });
    expect(hook.get().live).toBe(false);
    await answer(1, row('running'));
    expect(hook.get().live).toBe(true);
  });
});
