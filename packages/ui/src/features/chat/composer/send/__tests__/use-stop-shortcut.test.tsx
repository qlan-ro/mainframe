/**
 * ⌘. (chat.stop) stops the conversation that last had the focus, if it is on
 * screen, and nothing from any other surface.
 */
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialogHost } from '@/components/overlays/ConfirmDialogHost';
import { useConfirmBridge, requestConfirm } from '@/lib/confirm-bridge';
import { conversationProps } from '@/lib/conversation-focus';
import { useTrackConversationFocus } from '@/app/use-track-conversation-focus';
import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';

vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { useStopShortcut } from '../use-stop-shortcut';

const stopped: string[] = [];

function Composer({ chat, running = true }: { chat: string; running?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  useStopShortcut(anchor, () => stopped.push(chat), running);
  return (
    <>
      <span ref={anchor} hidden />
      <textarea aria-label={`message ${chat}`} />
      <p>transcript {chat}</p>
      <Popover>
        <PopoverTrigger>popover {chat}</PopoverTrigger>
        <PopoverContent>
          <input aria-label={`in popover ${chat}`} />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger>menu {chat}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>item {chat}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog>
        <DialogTrigger>dialog {chat}</DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Dialog</DialogTitle>
          <input aria-label={`in dialog ${chat}`} />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TabSpec {
  chat: string;
  running?: boolean;
  hidden?: boolean;
  /** The workspace is sliding out. */
  leaving?: boolean;
}
interface World {
  column?: string | null;
  columnRunning?: boolean;
  tabs?: TabSpec[];
}

function App({ column = 'main', columnRunning = true, tabs = [] }: World) {
  useShortcutDispatcher();
  useTrackConversationFocus();
  return (
    <>
      {column !== null && (
        <div {...conversationProps(column)}>
          <Composer chat={column} running={columnRunning} />
        </div>
      )}
      {tabs.map(({ chat, running, hidden, leaving }) => (
        <div key={chat} inert={leaving}>
          <div
            {...conversationProps(chat)}
            data-conversation-tab={hidden ? 'hidden' : 'active'}
            inert={hidden}
            tabIndex={-1}
            data-testid={`tab ${chat}`}
          >
            <Composer chat={chat} running={running} />
          </div>
        </div>
      ))}
      <div data-conversation-tab="active">
        <button>agent steps</button>
      </div>
      <textarea aria-label="terminal" />
      <div className="cm-editor">
        <textarea aria-label="editor" />
      </div>
      <button>sidebar</button>
      <button>settings</button>
      <p>files</p>
      <Dialog>
        <DialogTrigger>open palette</DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Commands</DialogTitle>
          <input aria-label="command palette" />
        </DialogContent>
      </Dialog>
      <ConfirmDialogHost />
    </>
  );
}

function show(world: World = {}) {
  const view = render(<App {...world} />);
  return { set: (next: World) => view.rerender(<App {...next} />), unmount: view.unmount };
}
const focus = (name: string) => act(() => screen.getByLabelText(name).focus());
const focusButton = (name: string) => act(() => screen.getByText(name).focus());
const blur = () => act(() => (document.activeElement as HTMLElement).blur());
const press = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { code: 'Period', key: '.', metaKey: true });

function expectStopped(...chats: string[]) {
  stopped.length = 0;
  press();
  expect(stopped).toEqual(chats);
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
});
beforeEach(() => {
  stopped.length = 0;
  useConfirmBridge.setState({ pending: null });
});

const BESIDE: World = { tabs: [{ chat: 'a' }, { chat: 'b' }] };

describe('the conversation with the focus', () => {
  it.each(['main', 'a', 'b'])('is the one stopped, of the column and two zones: %s', (chat) => {
    show(BESIDE);
    focus(`message ${chat}`);
    expectStopped(chat);
  });

  it('is the last of several', () => {
    show(BESIDE);
    focus('message main');
    focus('message a');
    focus('message b');
    focus('message a');
    expectStopped('a');
  });

  it('keeps it when the focus falls to nothing', () => {
    show(BESIDE);
    focus('message a');
    blur();
    expectStopped('a');
  });

  it('is stopped whether or not it runs, and no other in its place', () => {
    show({ column: 'main', tabs: [{ chat: 'a', running: false }] });
    focus('message a');
    expectStopped('a');
  });
});

describe('what a conversation opens', () => {
  it.each([
    ['popover', 'in popover a'],
    ['dialog', 'in dialog a'],
  ])('counts as it: a %s of a chat tab', async (kind, field) => {
    show(BESIDE);
    focus('message main');
    fireEvent.click(screen.getByText(`${kind} a`));
    const inside = await screen.findByLabelText(field);
    act(() => inside.focus());
    expect(inside.closest('[data-conversation]')).toBeNull();
    expectStopped('a');
  });

  it('counts as it: a menu of a chat tab', async () => {
    show(BESIDE);
    focus('message main');
    focusButton('menu a');
    fireEvent.keyDown(screen.getByText('menu a'), { key: 'Enter' });
    const item = await screen.findByText('item a');
    act(() => item.focus());
    expect(item).toHaveFocus();
    expectStopped('a');
  });

  it('counts as it: a confirmation the app shows for it, and no other surface’s', async () => {
    show(BESIDE);
    focus('message a');
    act(() => void requestConfirm({ title: 'Discard?' }));
    const cancel = await screen.findByTestId('confirm-dialog-cancel');
    act(() => cancel.focus());
    expectStopped('a');
    fireEvent.pointerDown(cancel);
    expectStopped('a');
    fireEvent.pointerDown(screen.getByText('files'));
    expect(cancel).toHaveFocus();
    expectStopped();
    fireEvent.click(cancel);

    focusButton('sidebar');
    act(() => void requestConfirm({ title: 'Delete the project?' }));
    act(() => screen.getByTestId('confirm-dialog-cancel').focus());
    expectStopped();
  });

  it('is not it any more once the conversation is closed', async () => {
    const view = show(BESIDE);
    fireEvent.click(screen.getByText('popover a'));
    act(() => screen.getByLabelText('in popover a').focus());
    view.set({ tabs: [{ chat: 'b' }] });
    expectStopped();
  });
});

describe('another surface with the focus since', () => {
  it.each([
    ['an agent tab', () => focusButton('agent steps')],
    ['a terminal', () => focus('terminal')],
    ['an editor', () => focus('editor')],
    ['the sidebar', () => focusButton('sidebar')],
    ['settings', () => focusButton('settings')],
  ])('stops nothing: %s', (_, go) => {
    show(BESIDE);
    focus('message a');
    go();
    expectStopped();
    blur();
    expectStopped();
    focus('message a');
    expectStopped('a');
  });

  it('stops nothing from the command palette, and the conversation again once it has the focus back', async () => {
    show(BESIDE);
    focus('message a');
    fireEvent.click(screen.getByText('open palette'));
    act(() => screen.getByLabelText('command palette').focus());
    expectStopped();
    fireEvent.keyDown(screen.getByLabelText('command palette'), { key: 'Escape' });
    focus('message a');
    expectStopped('a');
  });

  it('is settings, in the chat’s place, also once the chat is back', () => {
    const view = show();
    focus('message main');
    view.set({ column: null });
    focusButton('settings');
    expectStopped();
    blur();
    view.set({});
    expectStopped();
    focus('message main');
    expectStopped('main');
  });

  it('is one that was pressed, when a press there moves no focus', () => {
    show(BESIDE);
    focus('message a');
    blur();
    fireEvent.pointerDown(screen.getByText('files'));
    expectStopped();
    fireEvent.pointerDown(screen.getByText('transcript b'));
    expectStopped('b');
    focus('message a');
    blur();
    expectStopped('a');
  });

  it('is where the last press was, even when the focus stayed behind', () => {
    show(BESIDE);
    focus('message a');
    fireEvent.pointerDown(screen.getByText('files'));
    expectStopped();
    fireEvent.pointerDown(screen.getByText('transcript b'));
    expectStopped('b');
  });

  it.each([
    ['types', (field: HTMLElement) => fireEvent(field, new InputEvent('beforeinput', { bubbles: true, data: 'x' }))],
    ['uses an input method', (field: HTMLElement) => fireEvent.compositionStart(field)],
  ])('is where the focus is again once the user %s there', (_, enter) => {
    show(BESIDE);
    focus('message a');
    fireEvent.pointerDown(screen.getByText('transcript b'));
    for (const key of ['Shift', 'CapsLock', 'F5', 'Escape'])
      fireEvent.keyDown(screen.getByLabelText('message a'), { key });
    expectStopped('b');
    enter(screen.getByLabelText('message a'));
    expectStopped('a');
  });

  it('is the focused one again once the pressed one is behind another tab', () => {
    const view = show(BESIDE);
    focus('message a');
    fireEvent.pointerDown(screen.getByText('transcript b'));
    view.set({ tabs: [{ chat: 'a' }, { chat: 'b', hidden: true }] });
    expect(screen.getByLabelText('message a')).toHaveFocus();
    expectStopped('a');
  });

  it('is the chat that takes the place of a pressed one, where the focus stayed', () => {
    const view = show({ column: 'a', tabs: [] });
    focus('message a');
    fireEvent.pointerDown(screen.getByText('transcript a'));
    view.set({ column: 'c', tabs: [] });
    expect(screen.getByLabelText('message c')).toHaveFocus();
    expectStopped('c');
  });
});

describe('a conversation that had the focus but is off screen', () => {
  it.each([
    ['behind another tab', { tabs: [{ chat: 'a', hidden: true }, { chat: 'b' }] }],
    ['closed', { tabs: [{ chat: 'b' }] }],
    ['in a workspace on its way out', { tabs: [{ chat: 'a', leaving: true }] }],
  ])('is not stopped, nor another: %s', (_, next) => {
    const view = show(BESIDE);
    focus('message a');
    blur();
    view.set(next);
    expectStopped();
  });

  it('is stopped again when it is back', () => {
    const view = show(BESIDE);
    focus('message a');
    blur();
    view.set({ tabs: [{ chat: 'a', hidden: true }] });
    view.set(BESIDE);
    expectStopped('a');
  });

  it('is not the column’s next session, until that has the focus', () => {
    const view = show({ column: 'main' });
    focus('message main');
    blur();
    view.set({ column: 'other' });
    expectStopped();
    focus('message other');
    expectStopped('other');
  });

  it('gives way to the session shown under the focus', () => {
    const view = show({ column: 'main' });
    focus('message main');
    const field = document.activeElement;
    view.set({ column: 'other' });
    expect(field).toHaveFocus();
    expectStopped('other');
  });

  it('is found where it shows now: in a tab beside the column', () => {
    const view = show({ column: 'main' });
    focus('message main');
    blur();
    view.set({ column: 'other', tabs: [{ chat: 'main' }] });
    expectStopped('main');
  });

  it('is not the column, when the column is hidden', () => {
    const view = show({ tabs: [{ chat: 'a' }] });
    focus('message main');
    blur();
    view.set({ column: null, tabs: [{ chat: 'a' }] });
    expectStopped();
  });
});

describe('with no conversation focused since load', () => {
  it('stops the column’s turn when no other runs', () => {
    show({ tabs: [{ chat: 'a', running: false }] });
    expectStopped('main');
  });

  it.each<[string, World]>([
    ['another runs too', { tabs: [{ chat: 'a' }] }],
    ['another runs behind a tab', { tabs: [{ chat: 'a', hidden: true }] }],
    ['only a chat tab runs', { columnRunning: false, tabs: [{ chat: 'a' }] }],
    ['none runs', { columnRunning: false }],
    ['the column is hidden', { column: null, tabs: [{ chat: 'a' }] }],
  ])('stops nothing when %s', (_, world) => {
    show(world);
    expectStopped();
  });

  it('is over once any has had the focus', () => {
    const view = show({ tabs: [{ chat: 'a', running: false }] });
    focus('message a');
    blur();
    view.set({});
    expectStopped();
  });

  it('starts over with the shell', () => {
    const first = show(BESIDE);
    focus('message a');
    first.unmount();
    show();
    expectStopped('main');
  });
});
