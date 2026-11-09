import { describe, it, expect, vi, beforeEach } from 'vitest';

let listener: (event: { type: string; url?: string }) => void = () => {};
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (cb: typeof listener) => {
      listener = cb;
      return () => {};
    },
  },
}));
vi.mock('../refresh-artifact-tabs', () => ({ refreshArtifactTabs: (url: string) => mockRefresh(url) }));

import { installArtifactPublishSubscriber } from '../artifact-publish-subscriber';

describe('installArtifactPublishSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installArtifactPublishSubscriber();
  });

  it('refreshes previews of an artifact published anywhere', () => {
    listener({ type: 'artifact.published', url: 'https://claude.ai/artifact/abc' });
    expect(mockRefresh).toHaveBeenCalledWith('https://claude.ai/artifact/abc');
  });

  it('ignores other events and URLs that are not artifacts', () => {
    listener({ type: 'provider.quota.updated' });
    listener({ type: 'artifact.published', url: 'https://evil.example/artifact/abc' });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
