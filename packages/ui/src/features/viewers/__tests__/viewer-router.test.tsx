import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getProjectFile = vi.fn();
const getProjectFileBase64 = vi.fn();
let identity: { projectId: string | null; chatId: string | null } = { projectId: null, chatId: null };

vi.mock('@/lib/api/files', () => ({
  getProjectFile: (...a: unknown[]) => getProjectFile(...a),
  getProjectFileBase64: (...a: unknown[]) => getProjectFileBase64(...a),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 1 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => identity }));

import { ViewerRouter } from '../viewer-router';

describe('ViewerRouter — file loads are daemon-only', () => {
  beforeEach(() => {
    getProjectFile.mockReset();
    getProjectFileBase64.mockReset();
    identity = { projectId: null, chatId: null };
  });

  it('errors (no local-disk fallback) when there is no project context', async () => {
    render(<ViewerRouter path="/abs/photo.png" />);
    await screen.findByText('No project context for this file');
    // Critically: it must NOT have attempted any read at all.
    expect(getProjectFileBase64).not.toHaveBeenCalled();
    expect(getProjectFile).not.toHaveBeenCalled();
  });

  it('reads a binary file through the daemon when a project is active', async () => {
    identity = { projectId: 'p1', chatId: 'c1' };
    getProjectFileBase64.mockResolvedValueOnce('Zm9v');
    render(<ViewerRouter path="photo.png" />);
    await waitFor(() => expect(getProjectFileBase64).toHaveBeenCalledWith(1, 'p1', 'photo.png', 'c1'));
  });

  it('reads a text file through the daemon when a project is active', async () => {
    identity = { projectId: 'p1', chatId: 'c1' };
    getProjectFile.mockResolvedValueOnce('a,b\n1,2');
    render(<ViewerRouter path="data.csv" />);
    await waitFor(() => expect(getProjectFile).toHaveBeenCalledWith(1, 'p1', 'data.csv', 'c1'));
  });
});
