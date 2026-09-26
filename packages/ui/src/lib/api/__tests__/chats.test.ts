import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from '../http';
import { discardChat, listChats, trustWorkspace } from '../chats';

describe('trustWorkspace', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('POSTs to the trust-workspace endpoint', async () => {
    const spy = vi.spyOn(http, 'requestEmpty').mockResolvedValue(undefined);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await trustWorkspace(0, 'chat-1');
    expect(spy).toHaveBeenCalledWith('POST', 'http://d/api/chats/chat-1/trust-workspace');
  });
});

describe('discardChat (todo #346)', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('POSTs to the discard endpoint', async () => {
    const spy = vi.spyOn(http, 'requestEmpty').mockResolvedValue(undefined);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await discardChat(0, 'chat-1');
    expect(spy).toHaveBeenCalledWith('POST', 'http://d/api/chats/chat-1/discard');
  });
});

describe('listChats — includeTemporary (todo #346)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('omits the param by default', async () => {
    const spy = vi.spyOn(http, 'request').mockResolvedValue([]);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await listChats(0);
    const url = new URL(spy.mock.calls[0]![1] as string);
    expect(url.searchParams.has('includeTemporary')).toBe(false);
  });

  it('sets includeTemporary=true when requested', async () => {
    const spy = vi.spyOn(http, 'request').mockResolvedValue([]);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await listChats(0, { includeTemporary: true });
    const url = new URL(spy.mock.calls[0]![1] as string);
    expect(url.searchParams.get('includeTemporary')).toBe('true');
  });
});
