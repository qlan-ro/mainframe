// @vitest-environment jsdom
/** Entries of two daemons, whose chats can share an id, stay apart. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { closeUnsentDrafts, dropUnsentOf, hasUnsent, holdUnsent, useUnsentMessages } from '../unsent-store';

const LOCAL = getActiveDaemon();
const REMOTE: DaemonTarget = { ...LOCAL, id: 'remote-1', kind: 'remote' };
const hold = (threadId: string) =>
  holdUnsent({ threadId, draft: { text: 'x', items: [], attachments: [], references: {} }, sent: [] });
const owners = () => useUnsentMessages.getState().entries.map(({ threadId }) => threadId);

beforeEach(() => useUnsentMessages.setState({ entries: [] }));
afterEach(() => setActiveDaemon(LOCAL));

it('does not answer for, or drop, another daemon’s entry of the same id', () => {
  hold('chat-1');
  setActiveDaemon(REMOTE);
  expect(hasUnsent('chat-1')).toBe(false);
  dropUnsentOf('chat-1');
  expect(owners()).toEqual(['chat-1']);
  setActiveDaemon(LOCAL);
  expect(hasUnsent('chat-1')).toBe(true);
  dropUnsentOf('chat-1');
  expect(owners()).toEqual([]);
});

it('lets go of drafts only when their daemon is left', () => {
  hold('__LOCALID_1');
  hold('chat-1');
  closeUnsentDrafts();
  expect(hasUnsent('__LOCALID_1')).toBe(false);
  expect(hasUnsent('chat-1')).toBe(true);
});
