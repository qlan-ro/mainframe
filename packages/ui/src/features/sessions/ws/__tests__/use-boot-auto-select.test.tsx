import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBootAutoSelect } from '../use-boot-auto-select';
import { useLastSessionStore } from '../../../../store/last-session';
import { resetSessionListLoadState, useSessionListLoadState } from '../../runtime/list-load-state';
import type { SessionItem } from '../../view-model/chat-to-thread-custom';

const { settle } = vi.hoisted(() => ({ settle: vi.fn() }));
vi.mock('../../runtime/boot-chat-prewarm', () => ({ settleBootPrewarm: settle }));
vi.mock('../../runtime/new-thread-coordinator', () => ({ isCreateInFlight: () => false }));

function item(id: string, updatedAt: number, status = 'regular', projectId = 'p1'): SessionItem {
  return { id, remoteId: id, status, custom: { projectId, updatedAt } } as unknown as SessionItem;
}

const switchToThread = vi.fn();
const threads = { switchToThread } as never;

function boot(items: SessionItem[], main: string | null = '__LOCALID_boot', pending = false) {
  return renderHook((props: { items: SessionItem[] }) => useBootAutoSelect(props.items, main, threads, pending), {
    initialProps: { items },
  });
}

beforeEach(() => {
  settle.mockClear();
  switchToThread.mockClear();
  resetSessionListLoadState();
  useLastSessionStore.setState({ lastSessionId: null });
});

it('keeps the guess when the list agrees: the remembered chat is opened', () => {
  useLastSessionStore.setState({ lastSessionId: 'old' });
  boot([item('old', 1), item('new', 9)]);
  expect(switchToThread).toHaveBeenCalledWith('old');
  expect(settle).toHaveBeenCalledWith('old', new Set(['old', 'new']));
});

it('restores a remembered chat from another project', () => {
  useLastSessionStore.setState({ lastSessionId: 'other-project' });
  boot([item('here', 9, 'regular', 'p1'), item('other-project', 1, 'regular', 'p2')]);
  expect(switchToThread).toHaveBeenCalledWith('other-project');
  expect(settle.mock.calls[0]![0]).toBe('other-project');
});

it('drops the guess when the remembered chat was deleted: the most recent opens', () => {
  useLastSessionStore.setState({ lastSessionId: 'gone' });
  boot([item('a', 1), item('b', 5)]);
  expect(switchToThread).toHaveBeenCalledWith('b');
  expect(settle).toHaveBeenCalledWith('b', new Set(['a', 'b']));
});

it('drops the guess when the remembered chat was archived, and does not count it as listed', () => {
  useLastSessionStore.setState({ lastSessionId: 'arch' });
  boot([item('arch', 9, 'archived'), item('live', 1)]);
  expect(switchToThread).toHaveBeenCalledWith('live');
  expect(settle).toHaveBeenCalledWith('live', new Set(['live']));
});

it('settles with the chat the user already is on, when boot yields to them', () => {
  useLastSessionStore.setState({ lastSessionId: 'old' });
  boot([item('old', 1), item('mine', 5)], 'mine');
  expect(switchToThread).not.toHaveBeenCalled();
  expect(settle).toHaveBeenCalledWith('mine', new Set(['old', 'mine']));
});

it('settles with nothing when a New switch is pending', () => {
  useLastSessionStore.setState({ lastSessionId: 'old' });
  boot([item('old', 1)], '__LOCALID_boot', true);
  expect(switchToThread).not.toHaveBeenCalled();
  expect(settle).toHaveBeenCalledWith(null, new Set(['old']));
});

it('does not settle while the list is still empty and unloaded', () => {
  boot([]);
  expect(settle).not.toHaveBeenCalled();
});

it('settles with nothing once an empty list has loaded (first run)', () => {
  boot([]);
  act(() => useSessionListLoadState.getState().markLoaded());
  expect(settle).toHaveBeenCalledWith(null, new Set());
});

it('settles with nothing when the list failed before ever loading', () => {
  boot([]);
  act(() => useSessionListLoadState.getState().setFailed(true));
  expect(settle).toHaveBeenCalledWith(null, new Set());
});

it('decides once: a later list change does not settle or switch again', () => {
  useLastSessionStore.setState({ lastSessionId: 'a' });
  const view = boot([item('a', 1)]);
  view.rerender({ items: [item('a', 1), item('b', 9)] });
  expect(switchToThread).toHaveBeenCalledTimes(1);
  expect(settle).toHaveBeenCalledTimes(1);
});
