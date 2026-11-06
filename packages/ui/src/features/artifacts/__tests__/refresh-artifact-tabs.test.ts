import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrepare = vi.fn();
const mockRetarget = vi.fn();
let tabs: { id: string; kind: string; url?: string }[] = [];

vi.mock('@/lib/api/artifacts', () => ({ prepareArtifactPreview: (url: string) => mockPrepare(url) }));
vi.mock('@/lib/api/http', () => ({ apiBase: () => 'http://127.0.0.1:31415' }));
vi.mock('@/store/layout', () => ({
  useLayoutStore: {
    getState: () => ({ run: { panes: [{ tabs }] }, setUrlTabTarget: mockRetarget }),
  },
}));

import { refreshArtifactTabs } from '../refresh-artifact-tabs';

const ARTIFACT = 'https://claude.ai/artifact/abc';
const OLD = 'http://127.0.0.1:31415/api/artifact-preview/abc/1/index';
const NEW_PATH = '/api/artifact-preview/abc/2/index';

describe('refreshArtifactTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockResolvedValue({ status: 'ready', path: NEW_PATH, title: 'Coffee' });
    tabs = [{ id: 'open', kind: 'url', url: OLD }];
  });

  it('moves a tab showing the artifact to the new version', async () => {
    await refreshArtifactTabs(ARTIFACT);
    expect(mockRetarget).toHaveBeenCalledWith('open', `http://127.0.0.1:31415${NEW_PATH}`, 'Coffee');
  });

  it('downloads nothing when no tab shows the artifact', async () => {
    tabs = [{ id: 'other', kind: 'url', url: 'http://127.0.0.1:31415/api/artifact-preview/other/1/index' }];
    await refreshArtifactTabs(ARTIFACT);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('leaves a tab already on the newest version', async () => {
    tabs = [{ id: 'open', kind: 'url', url: `http://127.0.0.1:31415${NEW_PATH}` }];
    await refreshArtifactTabs(ARTIFACT);
    expect(mockRetarget).not.toHaveBeenCalled();
  });

  it('keeps the tab as it is when the download fails', async () => {
    mockPrepare.mockRejectedValue(new Error('offline'));
    await expect(refreshArtifactTabs(ARTIFACT)).resolves.toBeUndefined();
    expect(mockRetarget).not.toHaveBeenCalled();
  });
});
