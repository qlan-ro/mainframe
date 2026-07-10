import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getFileForView = vi.fn();
let identity: { projectId: string | null; chatId: string | null } = { projectId: null, chatId: null };

vi.mock('@/lib/api/files', () => ({
  getFileForView: (...a: unknown[]) => getFileForView(...a),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 1 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => identity }));

import { ViewerRouter } from '../viewer-router';

describe('ViewerRouter — file loads are daemon-only', () => {
  beforeEach(() => {
    getFileForView.mockReset();
    identity = { projectId: null, chatId: null };
  });

  it('errors (no local-disk fallback) when there is no project context', async () => {
    render(<ViewerRouter path="/abs/photo.png" />);
    await screen.findByText('No project context for this file');
    // Critically: it must NOT have attempted any read at all.
    expect(getFileForView).not.toHaveBeenCalled();
  });

  it('reads a binary file through the daemon when a project is active', async () => {
    identity = { projectId: 'p1', chatId: 'c1' };
    getFileForView.mockResolvedValueOnce({ content: 'Zm9v', external: false });
    render(<ViewerRouter path="photo.png" />);
    await waitFor(() => expect(getFileForView).toHaveBeenCalledWith(1, 'p1', 'photo.png', 'c1', { base64: true }));
  });

  it('reads a text file through the daemon when a project is active', async () => {
    identity = { projectId: 'p1', chatId: 'c1' };
    getFileForView.mockResolvedValueOnce({ content: 'a,b\n1,2', external: false });
    render(<ViewerRouter path="data.csv" />);
    await waitFor(() => expect(getFileForView).toHaveBeenCalledWith(1, 'p1', 'data.csv', 'c1', { base64: false }));
  });

  it('renders an out-of-project image served by the external fallback', async () => {
    identity = { projectId: 'p1', chatId: 'c1' };
    getFileForView.mockResolvedValueOnce({ content: 'Zm9v', external: true });
    render(<ViewerRouter path="/tmp/mf-annot.png" />);
    await waitFor(() =>
      expect(getFileForView).toHaveBeenCalledWith(1, 'p1', '/tmp/mf-annot.png', 'c1', { base64: true }),
    );
    // The image viewer mounts with a data URL — no error state.
    await waitFor(() => expect(screen.queryByText(/Path outside project/)).toBeNull());
  });
});
