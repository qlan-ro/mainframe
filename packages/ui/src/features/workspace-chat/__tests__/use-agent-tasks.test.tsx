/** useAgentTasks — the task list of one agent's call: what is kept, when it is asked again, and when it counts. */
import { act, render } from '@testing-library/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusProvider, type ConnectionStatus } from '@/app/ConnectionStatusContext';

/** Requests answered by hand, in the order they were made. */
const requests: { chatId: string; answer: (tasks: BackgroundTask[]) => void; refuse: () => void }[] = [];
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: (chatId: string) =>
    new Promise((resolve, reject) => {
      requests.push({ chatId, answer: resolve, refuse: () => reject(new Error('refused')) });
    }),
}));

import { useAgentTasks } from '../use-agent-tasks';

const row = (status: BackgroundTask['status'], overrides: Partial<BackgroundTask> = {}) =>
  ({ id: 'bg-1', toolUseId: 'call-1', status, startedAt: 1, ...overrides }) as BackgroundTask;

interface Props {
  events?: object;
  visible?: boolean;
  chatId?: string;
  connected?: boolean;
}
type Shown = ReturnType<typeof useAgentTasks>;
function Probe({ events, visible = true, chatId = 'parent', tell }: Props & { tell: (shown: Shown) => void }) {
  tell(useAgentTasks(chatId, 'call-1', events as never, visible));
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
const pass = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
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

  it('treats a request that never answers as refused, and takes no late answer to it', async () => {
    const hook = mount();
    await pass(15_000);
    await pass(1_000);
    expect(requests).toHaveLength(2);
    await answer(1, row('completed'));
    await answer(0, row('running'));
    expect(hook.statuses()).toEqual(['completed']);
    expect(requests).toHaveLength(2);
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
