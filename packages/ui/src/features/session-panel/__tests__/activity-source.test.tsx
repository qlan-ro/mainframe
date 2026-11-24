import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  current: undefined as
    { getState: () => { messages: unknown[] }; loadEarlier: (id: string) => Promise<boolean> } | undefined,
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => controller.current },
}));
const { ACTIVITY_JUMP_EVENT, focusPendingRequest, jumpToActivitySource } = await import('../activity-source');

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

    expect(await jump('call-1')).toBe(true);
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
    expect(await jump('call-1')).toBe(true);
    expect(scrollIntoView.mock.instances).toEqual([group.querySelector('[data-activity-id]')]);
  });

  it('falls back to the message when nothing marks the call', async () => {
    const root = transcript('<p>started</p>');
    expect(await jump()).toBe(true);
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
    controller.current = { getState: () => ({ messages }), loadEarlier };
  }

  it('loads the history up to the call and goes to its own row', async () => {
    const root = transcript('');
    const loadEarlier = vi.fn(async () => {
      messages.unshift({ id: 'm-2', content: [{ type: 'tool-call', toolCallId: 'call-2' }] });
      root.insertAdjacentHTML('afterbegin', '<div data-message-id="m-2"><div data-activity-id="call-2"></div></div>');
      return true;
    });
    windowed(loadEarlier);
    expect(await jumpTo('call-2')).toBe(true);
    expect(loadEarlier).toHaveBeenCalledExactlyOnceWith('call-2');
    expect(scrollIntoView.mock.instances).toEqual([root.querySelector('[data-activity-id="call-2"]')]);
  });

  it('reports a call the history does not hold, without moving', async () => {
    transcript('');
    windowed(async () => false);
    expect(await jumpTo('call-2')).toBe(false);
    windowed(async () => true);
    expect(await jumpTo('call-2')).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('passes on a load that failed', async () => {
    transcript('');
    windowed(() => Promise.reject(new Error('offline')));
    await expect(jumpTo('call-2')).rejects.toThrow('offline');
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
