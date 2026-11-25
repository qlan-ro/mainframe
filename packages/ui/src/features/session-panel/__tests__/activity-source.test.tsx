import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  current: undefined as
    | {
        getState: () => { messages: unknown[] };
        historyGeneration: number;
        loadEarlier: (id: string) => Promise<boolean>;
      }
    | undefined,
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => controller.current },
}));
const { ACTIVITY_JUMP_EVENT, cancelActivityJump, focusPendingRequest, jumpToActivitySource } =
  await import('../activity-source');

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  document.body.innerHTML = '';
  controller.current = undefined;
});

function transcript(html: string) {
  document.body.innerHTML = `
    <div data-mf-chat-thread data-mf-chat-id="other"><div data-message-id="m-1"><div data-activity-id="call-1"></div></div></div>
    <div data-mf-chat-thread data-mf-chat-id="chat-1"><div data-message-id="m-1" tabindex="-1">${html}</div></div>`;
  return document.querySelector<HTMLElement>('[data-mf-chat-id="chat-1"]')!;
}
const jump = (toolCallId?: string) => jumpToActivitySource('chat-1', { messageId: 'm-1', toolCallId });

describe('jumpToActivitySource', () => {
  it('opens the row, scrolls to it, highlights it and focuses it', async () => {
    const root = transcript('<div data-activity-id="call-1"><button aria-expanded="false">Monitor</button></div>');
    const button = root.querySelector('button')!;
    button.addEventListener('click', () => button.setAttribute('aria-expanded', 'true'));

    expect(await jump('call-1')).toBe('shown');
    const row = root.querySelector<HTMLElement>('[data-activity-id]')!;
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(scrollIntoView.mock.instances).toEqual([row]);
    expect(row).toHaveAttribute('data-activity-flash');
    expect(document.activeElement).toBe(button);
  });

  it('does not close a row that is already open', async () => {
    const root = transcript('<div data-activity-id="call-1"><button aria-expanded="true"></button></div>');
    const onClick = vi.fn();
    root.querySelector('button')!.addEventListener('click', onClick);
    await jump('call-1');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('finds a row that stands for several calls', async () => {
    const root = transcript('<div data-activity-id="call-0 call-1"></div><div data-activity-id="call-10"></div>');
    await jump('call-1');
    expect(scrollIntoView.mock.instances).toEqual([root.querySelector('[data-activity-id="call-0 call-1"]')]);
  });

  it('opens a collapsed group to reach a row it only renders once open', async () => {
    const root = transcript('<div data-activity-group="call-0 call-1"><button aria-expanded="false"></button></div>');
    const group = root.querySelector<HTMLElement>('[data-activity-group]')!;
    const button = group.querySelector('button')!;
    button.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'true');
      group.insertAdjacentHTML('beforeend', '<div data-activity-id="call-1"></div>');
    });
    expect(await jump('call-1')).toBe('shown');
    expect(scrollIntoView.mock.instances).toEqual([group.querySelector('[data-activity-id]')]);
  });

  it('falls back to the message when nothing marks the call', async () => {
    const root = transcript('<p>started</p>');
    expect(await jump()).toBe('shown');
    const message = root.querySelector<HTMLElement>('[data-message-id]')!;
    expect(scrollIntoView.mock.instances).toEqual([message]);
    expect(document.activeElement).toBe(message);
  });

  it('asks the transcript to bring the message in', async () => {
    transcript('');
    const listener = vi.fn();
    window.addEventListener(ACTIVITY_JUMP_EVENT, listener);
    await jump();
    window.removeEventListener(ACTIVITY_JUMP_EVENT, listener);
    expect(listener.mock.calls[0]![0].detail).toMatchObject({
      chatId: 'chat-1',
      source: { messageId: 'm-1', toolCallId: undefined },
    });
  });

  it('starts a row taller than the transcript at its top', async () => {
    const root = transcript('<div data-activity-id="call-1"></div>');
    Object.defineProperty(root, 'clientHeight', { value: 600 });
    const row = root.querySelector<HTMLElement>('[data-activity-id]')!;
    row.getBoundingClientRect = () => ({ top: 0, height: 900 }) as DOMRect;
    await jump('call-1');
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));

    row.getBoundingClientRect = () => ({ top: 0, height: 100 }) as DOMRect;
    await jump('call-1');
    expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ block: 'center' }));
  });

  it('starts at the top a row whose end would sit behind the composer', async () => {
    const root = transcript('<div data-activity-id="call-1"></div><div data-chat-footer></div>');
    Object.defineProperty(root, 'clientHeight', { value: 600 });
    Object.defineProperty(root.querySelector('[data-chat-footer]'), 'offsetHeight', { value: 200 });
    root.querySelector<HTMLElement>('[data-activity-id]')!.getBoundingClientRect = () =>
      ({ top: 0, height: 300 }) as DOMRect;
    await jump('call-1');
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });

  it('holds the scroll lock until the scroll has ended', async () => {
    transcript('<div data-activity-id="call-1"></div>');
    let settled = false;
    let settledAtScroll: boolean | undefined;
    const listener = (event: Event) =>
      void (event as CustomEvent<{ settled: Promise<void> }>).detail.settled.then(() => {
        settled = true;
      });
    scrollIntoView.mockImplementation(() => {
      setTimeout(() => {
        settledAtScroll = settled;
      }, 60);
    });
    window.addEventListener(ACTIVITY_JUMP_EVENT, listener);
    await jump('call-1');
    window.removeEventListener(ACTIVITY_JUMP_EVENT, listener);
    expect(settledAtScroll).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('focuses a row that has no control and was not focusable', async () => {
    const root = transcript('<div data-activity-id="call-1">Scheduled</div>');
    await jump('call-1');
    expect(document.activeElement).toBe(root.querySelector('[data-activity-id]'));
  });

  it('takes focus again when the row was remounted on the way', async () => {
    const root = transcript('<div data-activity-id="call-1"><button aria-expanded="true">Old</button></div>');
    const message = root.querySelector<HTMLElement>('[data-message-id]')!;
    scrollIntoView.mockImplementation(() => {
      message.innerHTML = '<div data-activity-id="call-1"><button aria-expanded="true">New</button></div>';
    });
    await jump('call-1');
    expect(document.activeElement).toHaveTextContent('New');
  });
});

describe('jumpToActivitySource — a call that is not loaded', () => {
  const messages: unknown[] = [];
  const jumpTo = (toolCallId: string) => jumpToActivitySource('chat-1', { toolCallId });
  function windowed(loadEarlier: (id: string) => Promise<boolean>) {
    messages.length = 0;
    messages.push({ id: 'm-9', content: [] });
    controller.current = { getState: () => ({ messages }), historyGeneration: 0, loadEarlier };
  }

  it('loads the history up to the call and goes to its own row', async () => {
    const root = transcript('');
    const loadEarlier = vi.fn(async () => {
      messages.unshift({ id: 'm-2', content: [{ type: 'tool-call', toolCallId: 'call-2' }] });
      root.insertAdjacentHTML('afterbegin', '<div data-message-id="m-2"><div data-activity-id="call-2"></div></div>');
      return true;
    });
    windowed(loadEarlier);
    expect(await jumpTo('call-2')).toBe('shown');
    expect(loadEarlier).toHaveBeenCalledExactlyOnceWith('call-2');
    expect(scrollIntoView.mock.instances).toEqual([root.querySelector('[data-activity-id="call-2"]')]);
  });

  it('reports a call the history does not hold, without moving', async () => {
    transcript('');
    windowed(async () => false);
    expect(await jumpTo('call-2')).toBe('missing');
    windowed(async () => true);
    expect(await jumpTo('call-2')).toBe('missing');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('passes on a load that failed', async () => {
    transcript('');
    windowed(() => Promise.reject(new Error('offline')));
    await expect(jumpTo('call-2')).rejects.toThrow('offline');
  });
});

describe('jumpToActivitySource — superseded', () => {
  const messages = [{ id: 'm-1', content: [{ type: 'tool-call', toolCallId: 'call-1' }] }];
  let mounts: string[] = [];
  const onMount = (event: Event) => mounts.push((event as CustomEvent).detail.source.messageId);
  beforeEach(() => {
    mounts = [];
    window.addEventListener(ACTIVITY_JUMP_EVENT, onMount);
  });
  afterEach(() => window.removeEventListener(ACTIVITY_JUMP_EVENT, onMount));

  /** A jump to call-2, whose history page is held; `arrive` lets it in. */
  function heldJump(root: HTMLElement) {
    let answer: (found: boolean | Error) => void = () => {};
    const held = [...messages] as unknown[];
    controller.current = {
      getState: () => ({ messages: held }),
      historyGeneration: 0,
      loadEarlier: () =>
        new Promise((resolve, reject) => {
          answer = (found) => (found instanceof Error ? reject(found) : resolve(found));
        }),
    };
    const onLocated = vi.fn();
    const outcome = jumpToActivitySource('chat-1', { toolCallId: 'call-2' }, onLocated);
    const arrive = () => {
      held.unshift({ id: 'm-2', content: [{ type: 'tool-call', toolCallId: 'call-2' }] });
      root.insertAdjacentHTML(
        'afterbegin',
        '<div data-message-id="m-2"><div data-activity-id="call-2"><button aria-expanded="false"></button></div></div>',
      );
      answer(true);
    };
    return { outcome, arrive, answer: (found: boolean | Error) => answer(found), onLocated };
  }

  it('does not move the transcript when its history arrives after another row was clicked', async () => {
    const root = transcript('<div data-activity-id="call-1"></div>');
    const slow = heldJump(root);
    expect(await jump('call-1')).toBe('shown');
    const focused = document.activeElement;
    slow.arrive();
    expect(await slow.outcome).toBe('superseded');
    expect(mounts).not.toContain('m-2');
    expect(slow.onLocated).not.toHaveBeenCalled();
    expect(scrollIntoView.mock.instances).toEqual([root.querySelector('[data-activity-id="call-1"]')]);
    expect(document.activeElement).toBe(focused);
  });

  it('does not move it after an action that shows something else', async () => {
    const root = transcript('');
    const slow = heldJump(root);
    cancelActivityJump();
    slow.arrive();
    expect(await slow.outcome).toBe('superseded');
    expect(mounts).toEqual([]);
  });

  it('leaves someone who started typing while its history loaded where they are', async () => {
    const root = transcript('');
    document.body.insertAdjacentHTML('beforeend', '<textarea id="field"></textarea>');
    const field = document.querySelector<HTMLTextAreaElement>('#field')!;
    const slow = heldJump(root);
    field.focus();
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    slow.arrive();
    expect(await slow.outcome).toBe('superseded');
    expect(slow.onLocated).not.toHaveBeenCalled();
    expect(mounts).toEqual([]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('still lands when a field only has focus, and after typing from before it was asked for', async () => {
    const root = transcript('');
    document.body.insertAdjacentHTML('beforeend', '<textarea id="field"></textarea>');
    const field = document.querySelector<HTMLTextAreaElement>('#field')!;
    field.focus();
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const slow = heldJump(root);
    slow.arrive();
    expect(await slow.outcome).toBe('shown');
  });

  it.each([
    ['was stopped', false],
    ['failed', new Error('detached')],
  ])('claims nothing about the history when its load %s because the session was left', async (_case, answer) => {
    const root = transcript('');
    const slow = heldJump(root);
    root.remove();
    controller.current!.historyGeneration++;
    slow.answer(answer);
    expect(await slow.outcome).toBe('superseded');
  });

  it.each([true, false])(
    'does not say the history lacks a call when a reload stopped its load (%s)',
    async (answer) => {
      const root = transcript('');
      const slow = heldJump(root);
      controller.current!.historyGeneration++;
      slow.answer(answer);
      await expect(slow.outcome).rejects.toThrow('The session reloaded meanwhile. Try again.');
    },
  );

  it('leaves the row alone when another jump came while its message mounted', async () => {
    const root = transcript('<div data-activity-id="call-1"></div>');
    const first = jumpToActivitySource('chat-1', { messageId: 'm-3', toolCallId: 'call-3' });
    await vi.waitFor(() => expect(mounts).toEqual(['m-3']));
    await jump('call-1');
    root.insertAdjacentHTML(
      'beforeend',
      '<div data-message-id="m-3"><div data-activity-id="call-3"><button aria-expanded="false"></button></div></div>',
    );
    const open = vi.fn();
    root.querySelector('[data-activity-id="call-3"] button')!.addEventListener('click', open);
    expect(await first).toBe('superseded');
    expect(open).not.toHaveBeenCalled();
    expect(mounts.filter((id) => id === 'm-3')).toHaveLength(1);
    expect(scrollIntoView.mock.instances).toEqual([root.querySelector('[data-activity-id="call-1"]')]);
  });

  it('stops opening groups on the way to its row', async () => {
    const root = transcript('');
    const first = jump('call-1');
    await vi.waitFor(() => expect(mounts).toHaveLength(2));
    cancelActivityJump();
    const open = vi.fn();
    root.querySelector('[data-message-id]')!.innerHTML =
      '<div data-activity-group="call-1"><button aria-expanded="false"></button></div>';
    root.querySelector('button')!.addEventListener('click', open);
    expect(await first).toBe('superseded');
    expect(open).not.toHaveBeenCalled();
  });

  it('does not take focus back after its scroll', async () => {
    transcript('<div data-activity-id="call-1"><button aria-expanded="true"></button></div>');
    scrollIntoView.mockImplementation(() => {
      cancelActivityJump();
      (document.activeElement as HTMLElement).blur();
    });
    await jump('call-1');
    expect(document.body).toHaveFocus();
  });

  it('does not highlight or focus a row it had just opened', async () => {
    const root = transcript('<div data-activity-id="call-1"><button aria-expanded="false"></button></div>');
    root.querySelector('button')!.addEventListener('click', cancelActivityJump);
    expect(await jump('call-1')).toBe('superseded');
    expect(root.querySelector('[data-activity-flash]')).toBeNull();
    expect(document.body).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not scroll back to its row while a later jump scrolls', async () => {
    const root = transcript('<div data-activity-id="call-1"></div><div data-activity-id="call-2"></div>');
    Object.defineProperty(root, 'clientHeight', { value: 600 });
    const [one, two] = [...root.querySelectorAll<HTMLElement>('[data-activity-id]')];
    // Out of place, so a jump that is still on corrects its scroll.
    one!.getBoundingClientRect = () => ({ top: -500, height: 20 }) as DOMRect;
    two!.getBoundingClientRect = () => ({ top: 100, height: 20 }) as DOMRect;
    const first = jump('call-1');
    await vi.waitFor(() => expect(scrollIntoView.mock.instances).toEqual([one]));
    const second = jump('call-2');
    await Promise.all([first, second]);
    expect(scrollIntoView.mock.instances).toEqual([one, two]);
    expect(document.activeElement).toBe(two);
  });
});

describe('focusPendingRequest', () => {
  it("focuses the first control of this chat's request", () => {
    const root = transcript('');
    root.insertAdjacentHTML('beforeend', '<div data-chat-gate><button>Allow once</button></div>');
    expect(focusPendingRequest('chat-1')).toBe(true);
    expect(document.activeElement).toHaveTextContent('Allow once');
  });

  it('reports when no request is showing', () => {
    transcript('');
    expect(focusPendingRequest('chat-1')).toBe(false);
  });
});
