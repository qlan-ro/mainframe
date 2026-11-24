import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => undefined },
}));
const { ACTIVITY_JUMP_EVENT, focusPendingRequest, jumpToActivitySource } = await import('../activity-source');

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  document.body.innerHTML = '';
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
    expect(listener.mock.calls[0]![0].detail).toEqual({
      chatId: 'chat-1',
      source: { messageId: 'm-1', toolCallId: undefined },
    });
  });
});

describe('focusPendingRequest', () => {
  it("focuses the first control of this chat's request", () => {
    const root = transcript('');
    root.insertAdjacentHTML('beforeend', '<div data-testid="chat-thread-gate-slot"><button>Allow once</button></div>');
    expect(focusPendingRequest('chat-1')).toBe(true);
    expect(document.activeElement).toHaveTextContent('Allow once');
  });

  it('reports when no request is showing', () => {
    transcript('');
    expect(focusPendingRequest('chat-1')).toBe(false);
  });
});
