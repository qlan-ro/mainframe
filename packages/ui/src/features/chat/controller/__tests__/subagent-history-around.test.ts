import { describe, expect, it, vi } from 'vitest';
import { SubagentHistoryClient } from '../subagent-history-client';
import type { AcpClientHandle } from '../acp-chat-controller';

function clientWith(capabilities: { historyAround?: boolean } | null, historyAround = vi.fn(async () => ({}))) {
  const handle = {
    ensureConnected: vi.fn(async () => undefined),
    mainframeCapabilities: capabilities,
    historyAround,
  } as unknown as AcpClientHandle;
  return {
    client: new SubagentHistoryClient(
      async () => handle,
      () => 'chat',
    ),
    historyAround,
  };
}

describe('SubagentHistoryClient.around', () => {
  it('asks for the one item, without neighbours, in this chat', async () => {
    const { client, historyAround } = clientWith({ historyAround: true });
    await client.around('call-1');
    expect(historyAround).toHaveBeenCalledWith({ sessionId: 'chat', itemId: 'call-1', before: 0, after: 0 });
  });

  it.each([[null], [{}], [{ historyAround: false }]])(
    'is null, and sends nothing, without the capability (%j)',
    async (caps) => {
      const { client, historyAround } = clientWith(caps);
      await expect(client.around('call-1')).resolves.toBeNull();
      expect(historyAround).not.toHaveBeenCalled();
    },
  );
});
