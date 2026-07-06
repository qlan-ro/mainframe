import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from '../http';
import { trustWorkspace } from '../chats';

describe('trustWorkspace', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('POSTs to the trust-workspace endpoint', async () => {
    const spy = vi.spyOn(http, 'requestEmpty').mockResolvedValue(undefined);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await trustWorkspace(0, 'chat-1');
    expect(spy).toHaveBeenCalledWith('POST', 'http://d/api/chats/chat-1/trust-workspace');
  });
});
